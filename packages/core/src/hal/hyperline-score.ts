// Turns seeded casual Hyperline runs into per-sector stats and 0..100 measures. A course the search
// bot cannot clear is a hard failure, never a lower score.
import { createCourse } from '../../../../games/hyperline/lib/course.js';
import { sectorAt } from '../../../../games/hyperline/lib/world.js';
import { casualRun, clearable, type CasualRun } from './hyperline-bot.js';
import type { Measures, ScoreReport } from './types.js';

export type SectorStats = { sector: number; reached: number; died: number; deathRate: number; causes: Record<string, number> };

/** Brian-reviewed thresholds; changing them changes what "good" means. */
export const HYPERLINE_BANDS = { early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, spikeJump: 0.3 };

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

export function scoreHyperline(range: { seeds: number; until: number }): ScoreReport<SectorStats> {
  const { seeds, until } = range;
  for (const [k, v] of [['seeds', seeds], ['until', until]] as const) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`scoreHyperline: ${k} must be a positive integer, got ${v}`);
  }
  const runs = Array.from({ length: seeds }, (_, i) => casualRun(i + 1, until));
  const levels: SectorStats[] = [];
  for (let s = 0; s <= sectorAt(until - 1); s++) levels.push(sectorStats(s, runs));
  const { early, minSurvive, spikeJump } = HYPERLINE_BANDS;

  const inBand = levels.filter((l) => l.reached > 0 && 1 - l.deathRate >= (l.sector <= early.upTo ? early.minSurvive : minSurvive)).length;
  let spikes = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i]!.deathRate - levels[i - 1]!.deathRate > spikeJump) spikes++;

  const measures: Measures = {
    inBand: round2((100 * inBand) / levels.length),
    noSpikes: round2(levels.length > 1 ? 100 * (1 - spikes / (levels.length - 1)) : 100),
    reach: round2((100 * median(runs.map((r) => r.dist))) / until),
  };

  const hardFailures: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const ok = clearable(createCourse(seed), until);
    if (ok === false) hardFailures.push(`seed ${seed}: not clearable to ${until}m`);
    else if (ok === 'unknown') hardFailures.push(`seed ${seed}: clearability unknown`);
  }
  return { game: 'hyperline', levels, measures, fitness: round2(mean(Object.values(measures))), hardFailures };
}
