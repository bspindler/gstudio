// The Hal CLI proper: score, baseline, check, status, screens. scripts/hal.ts wires the real scorers and directories;
// tests call main() with fakes. Output goes through console; main() returns the exit code instead of exiting.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  compareScores, emptyLedger, ledgerMarkdown, parseBaseline, parseLedger, rangeMismatch, recordPass, scorerFor, stagnated,
  type Baseline, type Ledger, type LevelStats, type Range, type ScoreReport, type Scorer,
} from '@studio/core/hal';

export type ScreensRun = { game: string; shots: string[]; errors: string[]; reached: boolean; notes: string[]; blockedRequests: string[] };
export type CliDeps = {
  scorers: Record<string, Scorer>;
  halDir: string;
  /** Loaded lazily so score/check never import Playwright. */
  runScreens?: (o: { outDir?: string }) => Promise<ScreensRun[]>;
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

async function run(argv: string[], { scorers, halDir, runScreens }: CliDeps): Promise<number> {
  const ledgerPath = join(halDir, 'ledger.json');
  const [command, ...rest] = argv;
  // Numeric flags are the union of every registered scorer's default keys; the chosen game then rejects the ones it lacks.
  const numericKeys = [...new Set(Object.values(scorers).flatMap((s) => Object.keys(s.defaults)))];
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        ...Object.fromEntries(numericKeys.map((k) => [k, { type: 'string' as const }])),
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

  if (command === 'status') {
    const ledger = loadLedger();
    console.log(ledgerMarkdown(ledger, 10));
    console.log(`Tidepool stagnated: ${stagnated(ledger, 'tidepool-pals') ? 'yes' : 'no'}`);
    const others = new Set([...ledger.passes.map((p) => p.game), ...Object.keys(ledger.streak)]);
    others.delete('tidepool-pals');
    for (const g of [...others].sort()) console.log(`${g} stagnated: ${stagnated(ledger, g) ? 'yes' : 'no'}`);
    return 0;
  }

  if (command === 'screens') {
    if (!runScreens) return fail('screens is not available here');
    const results = await runScreens({ outDir: values.out as string | undefined });
    let bad = false;
    for (const r of results) {
      const ok = r.reached && r.errors.length === 0;
      if (!ok) bad = true;
      console.log(`${r.game}: ${r.reached ? 'reached gameplay' : 'DID NOT REACH GAMEPLAY'}, ${r.shots.length} shots, ${r.errors.length} errors, ${r.blockedRequests.length} blocked requests`);
      for (const e of r.errors) console.log(`  error: ${e}`);
      for (const b of r.blockedRequests) console.log(`  blocked: ${b}`);
      for (const n of r.notes) console.log(`  note: ${n}`);
    }
    return bad ? 1 : 0;
  }

  // controls: wired after Task 6 merges (scripts/hal/controls.ts). Intentionally absent here.

  if (!['score', 'baseline', 'check'].includes(command ?? '')) {
    return fail('usage: npm run hal -- <score|baseline|check|status|screens> [--game <slug>] [--<key> N ...] [--json] [--change "..."] [--target <measure>] [--out dir]');
  }
  let scorer: Scorer;
  try {
    scorer = scorerFor((values.game as string | undefined) ?? 'tidepool-pals', scorers);
  } catch (e) {
    return fail((e as Error).message);
  }
  const GAME = scorer.game;
  const baselinePath = join(halDir, 'baseline', `${GAME}.json`);
  const range: Range = {};
  for (const k of numericKeys) {
    if (values[k] !== undefined && !(k in scorer.defaults)) fail(`--${k} does not apply to ${GAME}`);
  }
  for (const [k, d] of Object.entries(scorer.defaults)) {
    const v = values[k] as string | undefined;
    range[k] = v === undefined ? d : Number(v);
  }
  const rangeError = scorer.validate(range);
  if (rangeError) fail(rangeError);
  const change = values.change as string | undefined;
  const target = values.target as string | undefined;

  switch (command) {
    case 'score': {
      // A scorer that throws (browser unavailable, page errors, hang) is a hard failure: exit 1, nothing compared.
      const r = await scorer.score(range);
      if (values.json) console.log(JSON.stringify(r, null, 2));
      else printReport(r);
      return 0;
    }
    case 'baseline': {
      const r = await scorer.score(range);
      write(baselinePath, { range, report: r });
      console.log(`baseline written: ${baselinePath} (fitness ${r.fitness.toFixed(1)})`);
      return 0;
    }
    default: { // check
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
  }
}
