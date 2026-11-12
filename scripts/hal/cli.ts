// The Hal CLI proper: score, baseline, check, status, screens, controls. scripts/hal.ts wires the real scorers and directories;
// tests call main() with fakes. Output goes through console; main() returns the exit code instead of exiting.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  compareScores, emptyLedger, ledgerMarkdown, parseBaseline, parseLedger, rangeMismatch, recordPass, scorerFor, stagnated,
  type Baseline, type Ledger, type LevelStats, type Range, type ScoreReport, type Scorer,
} from '@studio/core/hal';
// Type-only imports are erased, so the CLI still never loads Playwright.
import { isOpsCommand, runOpsCommand } from './cli-ops.js';
import { isRunCommand, runRunCommand } from './cli-run.js';
import { scorersFor } from './candidate.js';
import { isStoreCommand, runStoreCommand } from './cli-store.js';
import type { ControlCheck } from './controls.js';
import type { ScreensResult } from './screens.js';

export type CliDeps = {
  scorers: Record<string, Scorer>;
  halDir: string;
  /** Loaded lazily so score/check never import Playwright. */
  runScreens?: (o: { outDir?: string }) => Promise<ScreensResult[]>;
  /** Loaded lazily too: the real-input controls check (scripts/hal/controls.ts). */
  runControlsCheck?: () => Promise<ControlCheck[]>;
  /** Injected clock for the stored-state commands (tell, notes, approve, spend). */
  now?: () => Date;
};

class Exit extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}
function fail(msg: string): never {
  console.error(msg);
  throw new Exit(1);
}

const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
};

function printReport(r: ScoreReport<unknown>) {
  if (r.game === 'tidepool-pals') {
    console.log('level  win %  moves left %  difficulty');
    (r.levels as LevelStats[]).forEach((l) =>
      console.log(`${String(l.n).padStart(5)}  ${(l.winRate * 100).toFixed(0).padStart(5)}  ${(l.avgMovesLeftFrac * 100).toFixed(0).padStart(12)}  ${l.difficulty.toFixed(1).padStart(10)}`));
  } else {
    r.levels.forEach((l) => console.log(JSON.stringify(l)));
  }
  for (const [k, v] of Object.entries(r.measures)) console.log(`${k}: ${v.toFixed(1)}`);
  console.log(`fitness: ${r.fitness.toFixed(1)}`);
  if (r.hardFailures.length) console.log(`hard failures: ${r.hardFailures.join('; ')}`);
}

/** Game slugs among scorer names: a scorer that is another game's second scorer (gearhold-play) is not a game. */
const gameSlugs = (names: string[]) => names.filter((n) => !names.some((g) => g !== n && scorersFor(g).includes(n)));

/** Runs the CLI and returns its exit code. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  try {
    return await run(argv, deps);
  } catch (e) {
    if (e instanceof Exit) return e.code;
    console.error(String((e as Error)?.message ?? e));
    return 1;
  }
}

async function run(argv: string[], { scorers, halDir, runScreens, runControlsCheck, now }: CliDeps): Promise<number> {
  const ledgerPath = join(halDir, 'ledger.json');
  const [command, ...rest] = argv;
  // Game slugs, not scorer names: gearhold-play is Gearhold's second scorer, not a game (tell --game, Run now, run --game).
  const games = gameSlugs(Object.keys(scorers));
  if (isStoreCommand(command)) return runStoreCommand(command, rest, { halDir, now, games });
  if (isOpsCommand(command)) return runOpsCommand(command, rest, { halDir, games });
  if (isRunCommand(command)) return runRunCommand(command, rest, { halDir, games, ...(now ? { now } : {}) });
  // Numeric flags are the union of every registered scorer's default keys; the chosen game then rejects the ones it lacks.
  // Flag names are kebab-case (seedBase -> --seed-base).
  const flag = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const numericKeys = [...new Set(Object.values(scorers).flatMap((s) => Object.keys(s.defaults)))];
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        ...Object.fromEntries(numericKeys.map((k) => [flag(k), { type: 'string' as const }])),
        game: { type: 'string' }, json: { type: 'boolean' }, change: { type: 'string' }, target: { type: 'string' }, out: { type: 'string' },
      },
    }));
  } catch (e) {
    return fail((e as Error).message);
  }

  function loadLedger(): Ledger {
    if (!existsSync(ledgerPath)) return emptyLedger();
    try {
      return parseLedger(readFileSync(ledgerPath, 'utf8'));
    } catch (e) {
      return fail((e as Error).message);
    }
  }

  if (command === 'screens') {
    if (!runScreens) return fail('screens is not available here');
    for (const k of Object.keys(values)) if (values[k] !== undefined && k !== 'out') fail(`--${k} does not apply to screens`);
    const results = await runScreens({ outDir: values.out as string | undefined });
    if (results.length === 0) return fail('screens produced no results');
    let bad = false;
    for (const r of results) {
      const ok = r.reached && r.errors.length === 0 && r.blockedRequests.length === 0;
      if (!ok) bad = true;
      console.log(`${r.game}: ${r.reached ? 'reached gameplay' : 'DID NOT REACH GAMEPLAY'}, ${r.shots.length} shots, ${r.errors.length} errors, ${r.blockedRequests.length} blocked requests`);
      for (const e of r.errors) console.log(`  error: ${e}`);
      for (const b of r.blockedRequests) console.log(`  blocked: ${b}`);
      for (const n of r.notes) console.log(`  note: ${n}`);
    }
    return bad ? 1 : 0;
  }

  if (command === 'controls') {
    if (!runControlsCheck) return fail('controls is not available here');
    for (const k of Object.keys(values)) if (values[k] !== undefined) fail(`--${k} does not apply to controls`);
    const checks = await runControlsCheck();
    if (checks.length === 0) return fail('controls produced no checks');
    let failed = 0, skipped = 0;
    for (const c of checks) {
      const status = c.skipped ? `skipped: ${c.skipped}` : c.ok ? 'ok' : 'FAIL';
      if (c.skipped) skipped++;
      else if (!c.ok) failed++;
      console.log(`${status.startsWith('skipped') ? status : status.padEnd(4)}  ${c.game}: ${c.check}${c.detail ? ` (${c.detail})` : ''}`);
    }
    console.log(`controls: ${checks.length - failed - skipped} ok, ${failed} failed, ${skipped} skipped`);
    return failed ? 1 : 0;
  }

  let scorer: Scorer;
  try {
    scorer = scorerFor((values.game as string | undefined) ?? 'tidepool-pals', scorers);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (values.out !== undefined) fail('--out applies only to screens');
  const GAME = scorer.game;
  const baselinePath = join(halDir, 'baseline', `${GAME}.json`);
  const range: Range = {};
  for (const k of numericKeys) {
    if (values[flag(k)] !== undefined && !(k in scorer.defaults)) fail(`--${flag(k)} does not apply to ${GAME}`);
  }
  for (const [k, d] of Object.entries(scorer.defaults)) {
    const v = values[flag(k)] as string | undefined;
    range[k] = v === undefined ? d : Number(v);
  }
  const rangeError = scorer.validate(range);
  if (rangeError) fail(rangeError);
  const change = values.change as string | undefined;
  const target = values.target as string | undefined;

  switch (command) {
    case 'status': {
      const ledger = loadLedger();
      console.log(ledgerMarkdown(ledger, 10));
      console.log(`Tidepool stagnated: ${stagnated(ledger, 'tidepool-pals') ? 'yes' : 'no'}`);
      const others = new Set([...ledger.passes.map((p) => p.game), ...Object.keys(ledger.streak)]);
      others.delete('tidepool-pals');
      for (const g of [...others].sort()) console.log(`${g} stagnated: ${stagnated(ledger, g) ? 'yes' : 'no'}`);
      return 0;
    }
    case 'score': {
      // A scorer that throws (browser unavailable, page errors, hang) is a hard failure: exit 1, nothing compared.
      const r = await scorer.score(range);
      if (values.json) console.log(JSON.stringify(r, null, 2));
      else printReport(r);
      return r.hardFailures.length ? fail(`score has ${r.hardFailures.length} hard failure(s)`) : 0;
    }
    case 'baseline': {
      const r = await scorer.score(range);
      if (r.hardFailures.length) fail(`baseline not written: ${r.hardFailures.length} hard failure(s): ${r.hardFailures.join('; ')}`);
      if (![r.fitness, ...Object.values(r.measures)].every(Number.isFinite)) fail('baseline not written: score has a non-finite fitness or measure');
      write(baselinePath, { range, report: r });
      console.log(`baseline written: ${baselinePath} (fitness ${r.fitness.toFixed(1)})`);
      return 0;
    }
    case 'check': {
      if (!change) fail('check needs --change "<what changed>"');
      const ledger = loadLedger(); // fail before scoring or writing anything
      const after = await scorer.score(range);
      if (![after.fitness, ...Object.values(after.measures)].every(Number.isFinite)) {
        fail('score has a non-finite fitness or measure; nothing recorded');
      }
      let base: Baseline | null = null;
      if (existsSync(baselinePath)) {
        try {
          base = parseBaseline(readFileSync(baselinePath, 'utf8'), GAME, Object.keys(scorer.defaults));
        } catch (e) {
          fail((e as Error).message);
        }
      }
      const before = base?.report ?? null;
      const mismatch = base ? rangeMismatch(base.range, range) : null;
      const res = mismatch ? { keep: false, gain: 0, reasons: [mismatch] } : compareScores(before, after, target);
      const next = recordPass(ledger, {
        ts: new Date().toISOString(), game: GAME, change, target,
        fitness: after.fitness, baseline: before ? before.fitness : null, measures: after.measures,
        kept: res.keep, reasons: res.reasons, costUsd: 0,
      });
      write(ledgerPath, next);
      if (res.keep) write(baselinePath, { range, report: after });
      console.log(`${res.keep ? 'KEEP' : 'DISCARD'} (gain ${res.gain.toFixed(2)}): ${res.reasons.join('; ')}`);
      return res.keep ? 0 : 2;
    }
    default:
      return fail('usage: npm run hal -- <score|baseline|check|status|screens|controls|run|stop|undo|tell|notes|approve|spend|serve|setup|install|uninstall> [--game <slug>] [--<key> N ...] [--json] [--change "..."] [--target <measure>] [--out dir]');
  }
}
