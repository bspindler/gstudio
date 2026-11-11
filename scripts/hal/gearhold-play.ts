// Gearhold play runner: the pure bot policy plays the real page headless, one fresh page per (level, seed).
// The decide -> step loop runs in the page (gearhold-play-page.ts, bundled with esbuild), in batches.
// Seeds: the page's Math.random comes from ?hal=<seed>; the policy rng is mulberry32(policySeed(seed, level)).
// Hard failures (page errors, a level that won't start, NaN state) go to `errors`, never into `records`.
// A browser that can't launch throws "browser unavailable: ..."; the CLI exits 1 on it.
// Run it with `npm run hal -- score --game gearhold-play [--levels N] [--seeds N] [--seed-base N]`.
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Browser } from 'playwright';
import { LEVELS } from '../../games/gearhold/levels.js';
import type { PlayRecord } from '../../packages/core/src/hal/gearhold-play-score.js';
import { GEARHOLD_PLAY_DEFAULTS } from '../../packages/core/src/hal/gearhold-play-score.js';
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
export const DEFAULT_SEEDS = GEARHOLD_PLAY_DEFAULTS.seeds;
const BATCH = 900; // decisions per page.evaluate (60 s of sim time)
/** Wall-clock bound per batch; a normal batch takes well under 1 s. */
export const BATCH_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;

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
  const { context, blockedRequests, consoleErrors } = await newHalContext(browser);
  const pageErrors: string[] = [];
  try {
    if (o.initScript) await context.addInitScript({ content: o.initScript });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('crash', () => pageErrors.push('page crashed'));
    const failed = (): string => (pageErrors.length ? `${tag}: page error: ${pageErrors[0]}`
      : consoleErrors.length ? `${tag}: console error: ${consoleErrors[0]}`
      : blockedRequests.length ? `${tag}: outbound request blocked: ${blockedRequests[0]}` : '');
    await page.goto(`${origin}/gearhold/index.html?hal=${seed}`);
    if ((await page.evaluate(() => (globalThis as any).document.getElementById('tag')?.textContent)) === 'needs WebGL 2')
      return `${tag}: page reports no WebGL 2`;
    await page.addScriptTag({ content: code });
    if (failed()) return failed();
    try {
      await bounded(page.evaluate(([l, m, p, c]) => (globalThis as any).__halPlay.begin(l, m, p, c), [level, map, policySeed(seed, level), o.cap] as const), o.batchTimeoutMs);
    } catch (e) {
      if ((e as Error)?.message !== HANG) throw e;
      return `${tag}: hang: starting the level took over ${o.batchTimeoutMs / 1000} s wall`;
    }
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
    // Also ends a page stuck in an endless evaluate; bounded so a stalled close can't hang the run.
    await bounded(context.close(), CLOSE_TIMEOUT_MS).catch(() => {});
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
