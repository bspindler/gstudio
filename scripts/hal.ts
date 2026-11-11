// npm run hal: score the game, keep a baseline, gate a change, show the ledger. Writes only under .data/hal/.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  compareScores, emptyLedger, ledgerMarkdown, parseBaseline, parseLedger, rangeMismatch, recordPass, scorerFor, SCORERS, stagnated,
  type Baseline, type Ledger, type LevelStats, type Range, type ScoreReport, type Scorer,
} from '@studio/core/hal';

// Same root local-env.ts uses; not imported from there so this CLI doesn't load the SQLite adapter.
const repo = fileURLToPath(new URL('../', import.meta.url));
const halDir = join(repo, '.data', 'hal');
const ledgerPath = join(halDir, 'ledger.json');

const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
};

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
// Numeric flags are the union of every registered scorer's default keys; the chosen game then rejects the ones it lacks.
const numericKeys = [...new Set(Object.values(SCORERS).flatMap((s) => Object.keys(s.defaults)))];
let values: Record<string, string | boolean | undefined>;
try {
  ({ values } = parseArgs({
    args: rest,
    options: {
      ...Object.fromEntries(numericKeys.map((k) => [k, { type: 'string' as const }])),
      game: { type: 'string' }, json: { type: 'boolean' }, change: { type: 'string' }, target: { type: 'string' },
    },
  }));
} catch (e) {
  fail((e as Error).message);
}
let scorer: Scorer;
try {
  scorer = scorerFor((values.game as string | undefined) ?? 'tidepool-pals');
} catch (e) {
  fail((e as Error).message);
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

function loadLedger(): Ledger {
  if (!existsSync(ledgerPath)) return emptyLedger();
  try {
    return parseLedger(readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    return fail((e as Error).message);
  }
}

switch (command) {
  case 'score': {
    const r = scorer.score(range);
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else printReport(r);
    break;
  }
  case 'baseline': {
    const r = scorer.score(range);
    write(baselinePath, { range, report: r });
    console.log(`baseline written: ${baselinePath} (fitness ${r.fitness.toFixed(1)})`);
    break;
  }
  case 'check': {
    if (!change) fail('check needs --change "<what changed>"');
    const ledger = loadLedger(); // fail before scoring or writing anything
    const after = scorer.score(range);
    if (![after.fitness, ...Object.values(after.measures)].every(Number.isFinite)) {
      fail('score has a non-finite fitness or measure; nothing recorded');
    }
    let base: Baseline | null = null;
    if (existsSync(baselinePath)) {
      try {
        base = parseBaseline(readFileSync(baselinePath, 'utf8'), GAME);
      } catch (e) {
        fail((e as Error).message);
      }
    }
    const before = base?.report ?? null;
    const mismatch = base ? rangeMismatch(base.range, range) : null;
    const res = mismatch ? { keep: false, gain: 0, reasons: [mismatch] } : compareScores(before, after, target);
    const next = recordPass(ledger, {
      ts: new Date().toISOString(), game: GAME, change: change, target: target,
      fitness: after.fitness, baseline: before ? before.fitness : null, measures: after.measures,
      kept: res.keep, reasons: res.reasons, costUsd: 0,
    });
    write(ledgerPath, next);
    if (res.keep) write(baselinePath, { range, report: after });
    console.log(`${res.keep ? 'KEEP' : 'DISCARD'} (gain ${res.gain.toFixed(2)}): ${res.reasons.join('; ')}`);
    process.exit(res.keep ? 0 : 2);
  }
  case 'status': {
    const ledger = loadLedger();
    console.log(ledgerMarkdown(ledger, 10));
    console.log(`Tidepool stagnated: ${stagnated(ledger, 'tidepool-pals') ? 'yes' : 'no'}`);
    const others = new Set([...ledger.passes.map((p) => p.game), ...Object.keys(ledger.streak)]);
    others.delete('tidepool-pals');
    for (const g of [...others].sort()) console.log(`${g} stagnated: ${stagnated(ledger, g) ? 'yes' : 'no'}`);
    break;
  }
  default:
    fail('usage: npm run hal -- <score|baseline|check|status> [--game <slug>] [--<key> N ...] [--json] [--change "..."] [--target <measure>]');
}
