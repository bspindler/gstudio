// Turns Gearhold's maps into per-level stats and 0..100 measures. Invalid levels are hard failures, never a lower score.
import { LEVELS } from '../../../../games/gearhold/levels.js';
import { walkLevel } from './gearhold-walk.js';
import type { ScoreReport } from './types.js';

export type MapStats = { n: number; name: string; routeLen: number; threat: number; threatPerStep: number; supply: number; startThreat: number };

/**
 * Brian-reviewed thresholds; changing them changes what "good" means. Two-sided so an emptier map
 * cannot score higher:
 * - supplied: threat 0 (nothing to heal from), or supply / threat in [minSupplyPerThreat, maxSupplyPerThreat].
 * - challenge: every level after the first needs threatPerStep >= minThreatPerStep.
 * - rising: a wall is threatPerStep > wallRatio x max(previous, minThreatPerStep), on raw values.
 */
export const GEARHOLD_BANDS = { maxStartThreat: 0, minSupplyPerThreat: 0.1, maxSupplyPerThreat: 1.0, wallRatio: 2, minThreatPerStep: 0.05 };

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function scoreGearhold(_range?: Record<string, never>): ScoreReport<MapStats> {
  const levels: MapStats[] = [];
  const valid: boolean[] = [];
  const rawPerStep: number[] = []; // unrounded threatPerStep; MapStats keeps the rounded display value
  const hardFailures: string[] = [];
  LEVELS.forEach((l, i) => {
    const n = i + 1;
    const w = walkLevel(l.map);
    for (const p of w.problems) hardFailures.push(`level ${n}: ${p}`);
    valid.push(w.problems.length === 0);
    const routeLen = Math.max(0, w.route.length - 1);
    rawPerStep.push(w.threatOnRoute / Math.max(1, routeLen));
    levels.push({
      n, name: l.name, routeLen, threat: w.threatOnRoute,
      threatPerStep: round2(rawPerStep[i]!),
      supply: w.supplyOnRoute, startThreat: w.startThreat,
    });
  });
  // Broken levels are reported as failures and left out of the measures.
  const ok = levels.filter((_, i) => valid[i]);
  const perStep = rawPerStep.filter((_, i) => valid[i]);
  const B = GEARHOLD_BANDS;
  const pct = (num: number, den: number): number => round2(den === 0 ? 100 : (100 * num) / den);
  const safeStarts = pct(ok.filter((s) => s.startThreat <= B.maxStartThreat).length, ok.length);
  const isSupplied = (s: MapStats): boolean =>
    s.threat === 0 || (s.supply / s.threat >= B.minSupplyPerThreat && s.supply / s.threat <= B.maxSupplyPerThreat);
  const supplied = pct(ok.filter(isSupplied).length, ok.length);
  const later = Math.max(0, ok.length - 1); // levels after the first; 0 means nothing to judge (100)
  let walls = 0;
  for (let i = 1; i < perStep.length; i++)
    if (perStep[i]! > B.wallRatio * Math.max(perStep[i - 1]!, B.minThreatPerStep)) walls++;
  const rising = pct(later - walls, later);
  const challenge = pct(perStep.slice(1).filter((t) => t >= B.minThreatPerStep).length, later);
  const measures = { safeStarts, supplied, rising, challenge };
  const vals = Object.values(measures);
  return { game: 'gearhold', levels, measures, fitness: round2(vals.reduce((a, b) => a + b, 0) / vals.length), hardFailures };
}
