// Turns seeded casual Hyperline runs into per-sector stats and 0..100 measures. A course the search
// bot cannot clear is a hard failure, never a lower score.
import { createCourse } from '../../../../games/hyperline/lib/course.js';
import { sectorAt } from '../../../../games/hyperline/lib/world.js';
import { casualRun, clearable, type CasualRun } from './hyperline-bot.js';
import type { Measures, ScoreReport } from './types.js';

export type SectorStats = { sector: number; reached: number; died: number; deathRate: number; causes: Record<string, number> };

/**
 * Brian-reviewed thresholds; changing them changes what "good" means. Every band is two-sided where
 * it can move, so a change that makes the game easier or emptier cannot raise the score.
 * - early: sectors 0..upTo need survival >= minSurvive (no upper bound: the opening may be gentle).
 * - later sectors need survival in [minSurvive, maxSurvive]; above maxSurvive is too easy.
 * - spikeJump: a death-rate rise between consecutive sectors that counts as a spike, judged only
 *   when both sectors were reached by >= minSample runs (fewer is seed luck, not a spike).
 * - reach: median casual distance / until scores 100 inside [lo, hi], falling linearly to 0 at 0 and 1.
 */
export const HYPERLINE_BANDS = {
  early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, maxSurvive: 0.97, spikeJump: 0.3, minSample: 8,
  reach: { lo: 0.35, hi: 0.65 },
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function sectorStats(sector: number, runs: CasualRun[]): SectorStats {
  const reached = runs.filter((r) => r.sector >= sector).length;
  const deaths = runs.filter((r) => r.sector === sector && r.cause !== '');
  const causes: Record<string, number> = {};
  for (const d of deaths) causes[d.cause] = (causes[d.cause] ?? 0) + 1;
  return { sector, reached, died: deaths.length, deathRate: reached ? deaths.length / reached : 0, causes };
}

/** 0..100 for a median-distance fraction of until: 100 inside the reach band, linear to 0 at 0 and at 1. */
export function reachScore(frac: number): number {
  const { lo, hi } = HYPERLINE_BANDS.reach;
  const f = Math.min(1, Math.max(0, frac));
  if (f < lo) return (100 * f) / lo;
  if (f > hi) return (100 * (1 - f)) / (1 - hi);
  return 100;
}

/** The three measures from per-sector stats and the median distance as a fraction of until. */
export function sectorMeasures(levels: SectorStats[], reachFrac: number): Measures {
  const { early, minSurvive, maxSurvive, spikeJump, minSample } = HYPERLINE_BANDS;
  const inBandOk = (l: SectorStats): boolean => {
    if (l.reached === 0) return false;
    const survive = 1 - l.deathRate;
    return l.sector <= early.upTo ? survive >= early.minSurvive : survive >= minSurvive && survive <= maxSurvive;
  };
  const inBand = levels.filter(inBandOk).length;
  // Spikes are judged only between consecutive sectors each reached by >= minSample runs (reached is
  // monotonic in real runs, so these form a prefix). Unreached or thin sectors count against inBand alone.
  let spikes = 0, pairs = 0;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i - 1]!.reached < minSample || levels[i]!.reached < minSample) continue;
    pairs++;
    if (levels[i]!.deathRate - levels[i - 1]!.deathRate > spikeJump) spikes++;
  }
  return {
    inBand: round2(levels.length ? (100 * inBand) / levels.length : 100),
    noSpikes: round2(pairs ? 100 * (1 - spikes / pairs) : 100),
    reach: round2(reachScore(reachFrac)),
  };
}

export function scoreHyperline(range: { seeds: number; until: number }): ScoreReport<SectorStats> {
  const { seeds, until } = range;
  for (const [k, v] of [['seeds', seeds], ['until', until]] as const) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`scoreHyperline: ${k} must be a positive integer, got ${v}`);
  }
  const runs = Array.from({ length: seeds }, (_, i) => casualRun(i + 1, until));
  const levels: SectorStats[] = [];
  for (let s = 0; s <= sectorAt(until - 1); s++) levels.push(sectorStats(s, runs));
  const measures = sectorMeasures(levels, median(runs.map((r) => r.dist)) / until);

  const hardFailures: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const ok = clearable(createCourse(seed), until);
    if (ok === false) hardFailures.push(`seed ${seed}: not clearable to ${until}m`);
    else if (ok === 'unknown') hardFailures.push(`seed ${seed}: clearability unknown`);
  }
  return { game: 'hyperline', levels, measures, fitness: round2(mean(Object.values(measures))), hardFailures };
}
