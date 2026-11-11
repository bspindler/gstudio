// Stored baseline: the report plus the range it was scored on, validated on load so a damaged file can't skew the gate.
import type { ScoreReport } from './types.js';

/** A scorer's numeric knobs, e.g. { from, to, seeds }. */
export type Range = Record<string, number>;
export type Baseline = { range: Range; report: ScoreReport<unknown> };

const bad = (why: string): never => { throw new Error(`corrupt baseline: ${why}`); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function parseJson(json: string): unknown {
  try { return JSON.parse(json); } catch (e) { return bad((e as Error).message); }
}

function checkReport(r: unknown): ScoreReport<unknown> {
  if (!isObj(r)) return bad('report is not an object');
  if (typeof r.game !== 'string') bad('game must be a string');
  if (!Array.isArray(r.levels)) bad('levels must be an array');
  if (!isObj(r.measures) || !Object.values(r.measures).every(num)) bad('measures must map names to finite numbers');
  if (!num(r.fitness)) bad('fitness must be a finite number');
  if (!Array.isArray(r.hardFailures) || !r.hardFailures.every((x) => typeof x === 'string')) bad('hardFailures must be a string array');
  return r as ScoreReport<unknown>;
}

export function parseScoreReport(json: string): ScoreReport<unknown> {
  return checkReport(parseJson(json));
}

/** `keys` are the game's range keys (its scorer's defaults); the stored range must have exactly those. */
export function parseBaseline(json: string, game: string, keys: string[]): Baseline {
  const b = parseJson(json);
  if (!isObj(b) || !isObj(b.range)) return bad('missing range');
  const have = Object.keys(b.range).sort();
  const want = [...keys].sort();
  if (have.length !== want.length || !have.every((k, i) => k === want[i]) || !Object.values(b.range).every(num)) {
    bad(`range needs numeric ${keys.join(', ')}`);
  }
  const report = checkReport(b.report);
  if (report.game !== game) bad(`report is for ${report.game}, not ${game}`);
  return { range: b.range as Range, report };
}

const fmt = (r: Range) => Object.keys(r).sort().map((k) => `${k}=${r[k]}`).join(', ');

/** Null when the ranges match (key order ignored), otherwise the reason the runs can't be compared. */
export function rangeMismatch(base: Range, now: Range): string | null {
  const bk = Object.keys(base).sort();
  const nk = Object.keys(now).sort();
  if (bk.length === nk.length && bk.every((k, i) => k === nk[i] && base[k] === now[k])) return null;
  if (bk.join() === 'from,seeds,to') {
    return `baseline was scored on levels ${base.from}–${base.to} × ${base.seeds} seeds; this run is ${now.from}–${now.to} × ${now.seeds}`;
  }
  return `baseline was scored with ${fmt(base)}; this run is ${fmt(now)}`;
}
