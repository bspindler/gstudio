// Hal ledger: append-only record of every keep/discard attempt. Pure; callers pass `ts` in.
import type { Measures } from './types.js';

export type Pass = {
  id: string; ts: string; game: string; change: string; target?: string;
  fitness: number; baseline: number | null; measures: Measures;
  kept: boolean; reasons: string[]; costUsd: number;
};
export type Ledger = { version: 1; passes: Pass[]; best: Record<string, number>; streak: Record<string, number> };

const MAX_PASSES = 500;

export const emptyLedger = (): Ledger => ({ version: 1, passes: [], best: {}, streak: {} });

const corrupt = (why: string): Error => new Error(`corrupt ledger: ${why}`);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumRecord = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every((n) => typeof n === 'number');

function validPass(p: unknown): boolean {
  if (!isObj(p)) return false;
  return typeof p.id === 'string' && /^HAL-\d+$/.test(p.id) && typeof p.ts === 'string' && typeof p.game === 'string'
    && typeof p.change === 'string' && (p.target === undefined || typeof p.target === 'string')
    && typeof p.fitness === 'number' && (p.baseline === null || typeof p.baseline === 'number')
    && isNumRecord(p.measures) && typeof p.kept === 'boolean'
    && Array.isArray(p.reasons) && p.reasons.every((r) => typeof r === 'string') && typeof p.costUsd === 'number';
}

export function parseLedger(json: string): Ledger {
  let v: unknown;
  try { v = JSON.parse(json); } catch (e) { throw corrupt((e as Error).message); }
  if (!isObj(v)) throw corrupt('not an object');
  if (v.version !== 1) throw corrupt(`unsupported version ${String(v.version)}`);
  if (!Array.isArray(v.passes) || !v.passes.every(validPass)) throw corrupt('bad passes');
  if (!isNumRecord(v.best)) throw corrupt('bad best');
  if (!isNumRecord(v.streak)) throw corrupt('bad streak');
  return { version: 1, passes: v.passes as Pass[], best: v.best, streak: v.streak };
}

const idNum = (p: Pass): number => Number(p.id.slice(4));

export function nextPassId(l: Ledger): string {
  const last = l.passes[l.passes.length - 1];
  const n = last ? idNum(last) + 1 : 1;
  return `HAL-${String(n).padStart(3, '0')}`;
}

export function recordPass(l: Ledger, p: Omit<Pass, 'id'>): Ledger {
  const pass: Pass = { ...p, id: nextPassId(l) };
  const best = { ...l.best };
  if (p.kept && (best[p.game] === undefined || p.fitness > best[p.game]!)) best[p.game] = p.fitness;
  const streak = { ...l.streak, [p.game]: p.kept ? 0 : (l.streak[p.game] ?? 0) + 1 };
  return { version: 1, passes: [...l.passes, pass].slice(-MAX_PASSES), best, streak };
}

export function stagnated(l: Ledger, game: string, k = 5): boolean {
  return (l.streak[game] ?? 0) >= k;
}

export function ledgerMarkdown(l: Ledger, last = 20): string {
  const rows = (last > 0 ? l.passes.slice(-last) : []).map((p) => {
    const delta = p.baseline === null ? '—' : `${p.fitness - p.baseline >= 0 ? '+' : ''}${(p.fitness - p.baseline).toFixed(1)}`;
    const base = p.baseline === null ? '—' : p.baseline.toFixed(1);
    return `| ${p.id} | ${p.game} | ${p.change.replace(/\|/g, '\\|')} | ${p.fitness.toFixed(1)} | ${base} | ${delta} | ${p.kept ? 'yes' : 'no'} |`;
  });
  return ['| ID | game | change | fitness | baseline | Δ | kept |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}
