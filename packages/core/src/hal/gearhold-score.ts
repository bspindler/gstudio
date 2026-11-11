// Turns Gearhold's maps into per-level stats and 0..100 measures. Invalid levels are hard failures, never a lower score.
import { LEVELS } from '../../../../games/gearhold/levels.js';
import { walkLevel } from './gearhold-walk.js';
import type { ScoreReport } from './types.js';

export type MapStats = { n: number; name: string; routeLen: number; threat: number; threatPerStep: number; supply: number; startThreat: number };

/** Brian-reviewed thresholds; changing them changes what "good" means. */
export const GEARHOLD_BANDS = { maxStartThreat: 0, minSupplyPerThreat: 0.1, wallRatio: 2 };

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function scoreGearhold(_range?: Record<string, never>): ScoreReport<MapStats> {
  const levels: MapStats[] = [];
  const valid: boolean[] = [];
  const hardFailures: string[] = [];
  LEVELS.forEach((l, i) => {
    const n = i + 1;
    const w = walkLevel(l.map);
    for (const p of w.problems) hardFailures.push(`level ${n}: ${p}`);
    valid.push(w.problems.length === 0);
    const routeLen = Math.max(0, w.route.length - 1);
    levels.push({
      n, name: l.name, routeLen, threat: w.threatOnRoute,
      threatPerStep: round2(w.threatOnRoute / Math.max(1, routeLen)),
      supply: w.supplyOnRoute, startThreat: w.startThreat,
    });
  });
  // Broken levels are reported as failures and left out of the measures.
  const ok = levels.filter((_, i) => valid[i]);
  const pct = (num: number, den: number): number => round2(den === 0 ? 100 : (100 * num) / den);
  const safeStarts = pct(ok.filter((s) => s.startThreat <= GEARHOLD_BANDS.maxStartThreat).length, ok.length);
  const supplied = pct(ok.filter((s) => s.supply / Math.max(1, s.threat) >= GEARHOLD_BANDS.minSupplyPerThreat).length, ok.length);
  let walls = 0;
  for (let i = 1; i < ok.length; i++)
    if (ok[i]!.threatPerStep > GEARHOLD_BANDS.wallRatio * ok[i - 1]!.threatPerStep) walls++;
  const rising = ok.length < 2 ? 100 : round2(100 * (1 - walls / (ok.length - 1)));
  const measures = { safeStarts, supplied, rising };
  const vals = Object.values(measures);
  return { game: 'gearhold', levels, measures, fitness: round2(vals.reduce((a, b) => a + b, 0) / vals.length), hardFailures };
}
