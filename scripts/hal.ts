// npm run hal: score the game, keep a baseline, gate a change, show the ledger. Writes only under .data/hal/.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  compareScores, emptyLedger, ledgerMarkdown, parseBaseline, parseLedger, rangeMismatch, recordPass, scoreTidepool, stagnated,
  type Baseline, type Ledger, type ScoreRange, type ScoreReport,
} from '@studio/core/hal';

// Same root local-env.ts uses; not imported from there so this CLI doesn't load the SQLite adapter.
const repo = fileURLToPath(new URL('../', import.meta.url));
const GAME = 'tidepool-pals';
const halDir = join(repo, '.data', 'hal');
const baselinePath = join(halDir, 'baseline', `${GAME}.json`);
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
let values: { from?: string; to?: string; seeds?: string; json?: boolean; change?: string; target?: string };
try {
  ({ values } = parseArgs({
    args: rest,
    options: {
      from: { type: 'string' }, to: { type: 'string' }, seeds: { type: 'string' }, json: { type: 'boolean' },
      change: { type: 'string' }, target: { type: 'string' },
    },
  }));
} catch (e) {
  fail((e as Error).message);
}
const int = (v: string | undefined, d: number, name: string) => {
  const n = v === undefined ? d : Number(v);
  if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a positive integer`);
  return n;
};
const range: ScoreRange = { from: int(values.from, 1, 'from'), to: int(values.to, 30, 'to'), seeds: int(values.seeds, 20, 'seeds') };
if (range.from > range.to) fail('--from must not exceed --to');

function printReport(r: ScoreReport) {
  console.log('level  win %  moves left %  difficulty');
  r.levels.forEach((l, i) =>
    console.log(`${String(range.from + i).padStart(5)}  ${(l.winRate * 100).toFixed(0).padStart(5)}  ${(l.avgMovesLeftFrac * 100).toFixed(0).padStart(12)}  ${l.difficulty.toFixed(1).padStart(10)}`));
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
    const r = scoreTidepool(range);
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else printReport(r);
    break;
  }
  case 'baseline': {
    const r = scoreTidepool(range);
    write(baselinePath, { range, report: r });
    console.log(`baseline written: ${baselinePath} (fitness ${r.fitness.toFixed(1)})`);
    break;
  }
  case 'check': {
    if (!values.change) fail('check needs --change "<what changed>"');
    const ledger = loadLedger(); // fail before scoring or writing anything
    const after = scoreTidepool(range);
    let base: Baseline | null = null;
    if (existsSync(baselinePath)) {
      try {
        base = parseBaseline(readFileSync(baselinePath, 'utf8'));
      } catch (e) {
        fail((e as Error).message);
      }
    }
    const before = base?.report ?? null;
    const mismatch = base ? rangeMismatch(base.range, range) : null;
    const res = mismatch ? { keep: false, gain: 0, reasons: [mismatch] } : compareScores(before, after, values.target);
    const next = recordPass(ledger, {
      ts: new Date().toISOString(), game: GAME, change: values.change, target: values.target,
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
    console.log(`Tidepool stagnated: ${stagnated(ledger, GAME) ? 'yes' : 'no'}`);
    break;
  }
  default:
    fail('usage: npm run hal -- <score|baseline|check|status> [--from N] [--to N] [--seeds N] [--json] [--change "..."] [--target <measure>]');
}
