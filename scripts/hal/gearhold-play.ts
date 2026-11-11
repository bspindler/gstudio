// Gearhold play runner: the pure bot policy plays the real page headless, one fresh page per (level, seed).
// The decide -> step loop runs in the page (gearhold-play-page.ts, bundled with esbuild), in batches.
// Seeds: the page's Math.random comes from ?hal=<seed>; the policy rng is mulberry32(policySeed(seed, level)).
// Hard failures (page errors, a level that won't start, NaN state) go to `errors`, never into `records`.
// A browser that can't launch throws "browser unavailable: ..."; the CLI below exits 1 on it.
//   npx tsx scripts/hal/gearhold-play.ts [--levels 0,1,2] [--seeds 50] [--seedBase 0] [--json]
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Browser } from 'playwright';
import { LEVELS } from '../../games/gearhold/levels.js';
import type { PlayRecord } from '../../packages/core/src/hal/gearhold-play-score.js';
import { scoreGearholdPlay } from '../../packages/core/src/hal/gearhold-play-score.js';
import { closeAll, launchBrowser, newHalContext, repo, serveGames, type StaticServer } from './browser.js';
import type { PageOutcome } from './gearhold-play-page.js';

export type GearholdPlayOptions = {
  levels: number[]; seeds?: number; seedBase?: number;
  /** Sim-time cap per run in seconds (default SIM_CAP, 240). Tests lower it to exercise 'timeout'. */
  simCap?: number;
  /** Wall-clock bound per page.evaluate batch in ms (default BATCH_TIMEOUT_MS); exceeding it is a 'hang' error. */
  batchTimeoutMs?: number;
  /** Test hook: script added to every run's context before the page loads (to inject faults). */
  initScript?: string;
};
export type GearholdPlayResult = { records: PlayRecord[]; errors: string[] };

/** Sim-time cap per run (seconds); hitting it ends the run as 'timeout' with a cause. */
export const SIM_CAP = 240;
/** Default seeds per level: 50 keeps the fitness spread over disjoint seed blocks under the gate's 0.5 (task 3 report). */
export const DEFAULT_SEEDS = 50;
const BATCH = 900; // decisions per page.evaluate (60 s of sim time)
/** Wall-clock bound per batch; a normal batch takes well under 1 s. */
export const BATCH_TIMEOUT_MS = 30_000;

/** Policy rng seed for a run: separate from the page seed, distinct per (seed, level). */
export function policySeed(seed: number, level: number): number {
  return (Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(level + 1, 0x85ebca6b)) >>> 0;
}

let bundle: Promise<string> | null = null;
/** The in-page driver plus the policy, as one IIFE (built once per process). */
export function policyBundle(): Promise<string> {
  bundle ??= build({
    entryPoints: [join(repo, 'scripts', 'hal', 'gearhold-play-page.ts')],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent',
  }).then((r) => r.outputFiles[0]!.text);
  return bundle;
}

/** Rejects with HANG after `ms` of wall time. */
const HANG = 'hang';
function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(HANG)), ms); })])
    .finally(() => clearTimeout(timer));
}

type RunOpts = { cap: number; batchTimeoutMs: number; initScript?: string };

async function playOne(browser: Browser, origin: string, code: string, level: number, seed: number, o: RunOpts): Promise<PlayRecord | string> {
  const tag = `level ${level} seed ${seed}`;
  const map = LEVELS[level]?.map as string[] | undefined;
  if (!map) return `${tag}: no such level`;
  const { context, blockedRequests } = await newHalContext(browser);
  const pageErrors: string[] = [];
  try {
    if (o.initScript) await context.addInitScript({ content: o.initScript });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('crash', () => pageErrors.push('page crashed'));
    const failed = (): string => (pageErrors.length ? `${tag}: page error: ${pageErrors[0]}`
      : blockedRequests.length ? `${tag}: outbound request blocked: ${blockedRequests[0]}` : '');
    await page.goto(`${origin}/gearhold/index.html?hal=${seed}`);
    if ((await page.evaluate(() => (globalThis as any).document.getElementById('tag')?.textContent)) === 'needs WebGL 2')
      return `${tag}: page reports no WebGL 2`;
    await page.addScriptTag({ content: code });
    if (failed()) return failed();
    await page.evaluate(([l, m, p, c]) => (globalThis as any).__halPlay.begin(l, m, p, c), [level, map, policySeed(seed, level), o.cap] as const);
    let out: PageOutcome;
    do {
      try {
        out = await bounded(page.evaluate((n) => (globalThis as any).__halPlay.batch(n), BATCH), o.batchTimeoutMs);
      } catch (e) {
        if ((e as Error)?.message !== HANG) throw e;
        return `${tag}: hang: a ${BATCH}-decision batch took over ${o.batchTimeoutMs / 1000} s wall`;
      }
      if (failed()) return failed();
    } while (!out.done);
    // Let queued page tasks run (an async error thrown during the last batch) before trusting the outcome.
    await bounded(page.evaluate(() => new Promise((r) => setTimeout(r, 0))), o.batchTimeoutMs).catch(() => {});
    if (failed()) return failed();
    if (!out.ok) return `${tag}: ${out.error}`;
    const s = out.state;
    return {
      level, seed, result: out.result, time: s.time, hpLeft: s.p.hp, kills: s.kills, foes: s.foes,
      shotsFired: s.shotsFired, hits: s.hits, damageTaken: s.damageTaken, damageUnseen: s.damageUnseen, cause: out.cause,
    };
  } catch (e) {
    return `${tag}: ${String((e as Error)?.message ?? e).split('\n')[0]}`;
  } finally {
    await context.close().catch(() => {}); // also ends a page stuck in an endless evaluate
  }
}

/** Plays levels x seeds (seeds seedBase .. seedBase+seeds-1). Reuses one browser and one static server. */
export async function runGearholdPlay({ levels, seeds = DEFAULT_SEEDS, seedBase = 0, simCap = SIM_CAP, batchTimeoutMs = BATCH_TIMEOUT_MS, initScript }: GearholdPlayOptions): Promise<GearholdPlayResult> {
  if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(seedBase) || seedBase < 0)
    throw new Error(`runGearholdPlay: seeds must be a positive integer and seedBase a non-negative integer (got ${seeds}, ${seedBase})`);
  const code = await policyBundle();
  let server: StaticServer | undefined, browser: Browser | undefined;
  const records: PlayRecord[] = [], errors: string[] = [];
  try {
    browser = await launchBrowser(); // throws "browser unavailable: ..."
    server = await serveGames();
    for (const level of levels)
      for (let seed = seedBase; seed < seedBase + seeds; seed++) {
        const r = await playOne(browser, server.origin, code, level, seed, { cap: simCap, batchTimeoutMs, initScript });
        if (typeof r === 'string') errors.push(r); else records.push(r);
      }
  } finally {
    await closeAll(browser, server);
  }
  return { records, errors };
}

/** Calibration table: per level win rate, median win time, hit ratio, unseen share and loss causes. */
export function playTable(records: PlayRecord[]): string {
  const rep = scoreGearholdPlay(records);
  const lines = ['| level | n | win rate | median win s | hit ratio | unseen share | losses |', '|---|---|---|---|---|---|---|'];
  for (const l of rep.levels) {
    const losses = records.filter((r) => r.level === l.level && r.result !== 'win');
    const kinds = new Map<string, number>();
    for (const r of losses) {
      const k = r.result === 'timeout' ? `timeout (${r.cause.split(':')[0]})` : `dead (${/enemy (\w+)/.exec(r.cause)?.[1] ?? 'no enemy near'})`;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    lines.push(`| ${l.level} | ${l.n} | ${l.winRate} | ${l.medianWinTime === null ? '-' : l.medianWinTime.toFixed(1)} | ${l.hitRatio} | ${l.unseenShare} | ${[...kinds].map(([k, n]) => `${n}x ${k}`).join(', ') || '-'} |`);
  }
  return `${lines.join('\n')}\n\nmeasures ${JSON.stringify(rep.measures)} fitness ${rep.fitness}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? '' : d; };
  const int = (s: string, min: number): number | null => (/^\d+$/.test(s) && Number(s) >= min ? Number(s) : null);
  const levels = arg('levels', '0,1,2').split(',').map((x) => int(x.trim(), 0));
  const seeds = int(arg('seeds', String(DEFAULT_SEEDS)), 1), seedBase = int(arg('seedBase', '0'), 0);
  if (levels.some((l) => l === null) || seeds === null || seedBase === null) {
    console.error('usage: --levels <non-negative integers, comma separated> --seeds <positive integer> --seedBase <non-negative integer>');
    process.exit(1);
  }
  const t0 = performance.now();
  try {
    const { records, errors } = await runGearholdPlay({ levels: levels as number[], seeds, seedBase });
    const secs = (performance.now() - t0) / 1000;
    if (errors.length) {
      // A run with hard failures has no score: print only the failures.
      for (const e of errors) console.error(`hard failure: ${e}`);
      console.error(`${errors.length} hard failure(s), ${records.length} runs completed; no score`);
      process.exit(1);
    }
    if (process.argv.includes('--json')) console.log(JSON.stringify({ records, errors, secs }, null, 1));
    else {
      for (const r of records) console.log(`L${r.level} s${r.seed} ${r.result} ${r.time.toFixed(1)}s hp ${r.hpLeft} kills ${r.kills}/${r.foes} hits ${r.hits}/${r.shotsFired} dmg ${r.damageTaken} (${r.damageUnseen} unseen) | ${r.cause}`);
      if (records.length) console.log(`\n${playTable(records)}`);
      console.log(`\n${records.length} runs in ${secs.toFixed(1)} s wall`);
    }
    process.exit(0);
  } catch (e) {
    console.error(String((e as Error)?.message ?? e));
    process.exit(1);
  }
}
