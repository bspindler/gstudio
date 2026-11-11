// Stored baseline: the report plus the range it was scored on, validated on load so a damaged file can't skew the gate.
import type { ScoreReport } from './types.js';

export type ScoreRange = { from: number; to: number; seeds: number };
export type Baseline = { range: ScoreRange; report: ScoreReport };

const bad = (why: string): never => { throw new Error(`corrupt baseline: ${why}`); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function parseJson(json: string): unknown {
  try { return JSON.parse(json); } catch (e) { return bad((e as Error).message); }
}

function checkReport(r: unknown): ScoreReport {
  if (!isObj(r)) return bad('report is not an object');
  if (typeof r.game !== 'string') bad('game must be a string');
  if (!Array.isArray(r.levels)) bad('levels must be an array');
  if (!isObj(r.measures) || !Object.values(r.measures).every(num)) bad('measures must map names to finite numbers');
  if (!num(r.fitness)) bad('fitness must be a finite number');
  if (!Array.isArray(r.hardFailures) || !r.hardFailures.every((x) => typeof x === 'string')) bad('hardFailures must be a string array');
  return r as unknown as ScoreReport;
}

export function parseScoreReport(json: string): ScoreReport {
  return checkReport(parseJson(json));
}

export function parseBaseline(json: string): Baseline {
  const b = parseJson(json);
  if (!isObj(b) || !isObj(b.range)) return bad('missing range');
  const { from, to, seeds } = b.range;
  if (!num(from) || !num(to) || !num(seeds)) bad('range needs numeric from, to, seeds');
  return { range: { from, to, seeds } as ScoreRange, report: checkReport(b.report) };
}

/** Null when the ranges match, otherwise the reason the runs can't be compared. */
export function rangeMismatch(base: ScoreRange, now: ScoreRange): string | null {
  if (base.from === now.from && base.to === now.to && base.seeds === now.seeds) return null;
  return `baseline was scored on levels ${base.from}–${base.to} × ${base.seeds} seeds; this run is ${now.from}–${now.to} × ${now.seeds}`;
}
