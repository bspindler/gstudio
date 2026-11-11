// Turns many robot plays into per-level stats and 0..100 measures. Invalid levels are hard failures, never a lower score.
import { difficulty, levelDef, validateLevel, withoutTides } from '../../../../games/tidepool-pals/levels.js';
import { playLevel } from './tidepool-bot.js';
import type { LevelStats, Measures, ScoreReport } from './types.js';

/** Brian-reviewed thresholds; changing them changes what "good" means. */
export const TIDEPOOL_BANDS = { early: { upTo: 5, minWin: 0.9 }, minWin: 0.25, wallDrop: 0.3 };

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function statsFor(n: number, seeds: number): LevelStats {
  const def = levelDef(n);
  const plays = Array.from({ length: seeds }, (_, i) => playLevel(def, i + 1));
  const errors = [...new Set([...validateLevel(def), ...validateLevel(withoutTides(def))])];
  return {
    n,
    winRate: mean(plays.map((p) => (p.won ? 1 : 0))),
    avgMovesLeftFrac: mean(plays.map((p) => p.movesLeft / def.moves)),
    avgGoalFrac: mean(plays.map((p) => p.goalFrac)),
    difficulty: difficulty(def),
    errors,
  };
}

export function scoreTidepool(opts: { from: number; to: number; seeds: number }): ScoreReport {
  const levels: LevelStats[] = [];
  for (let n = opts.from; n <= opts.to; n++) levels.push(statsFor(n, opts.seeds));
  const { early, minWin, wallDrop } = TIDEPOOL_BANDS;

  const inBand = levels.filter((l) => l.winRate >= (l.n <= early.upTo ? early.minWin : minWin)).length;
  let walls = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i - 1]!.winRate - levels[i]!.winRate > wallDrop) walls++;
  const lost = levels.filter((l) => l.winRate < 1);

  const measures: Measures = {
    inBand: round2(levels.length ? (100 * inBand) / levels.length : 0),
    noWalls: round2(levels.length > 1 ? 100 * (1 - walls / (levels.length - 1)) : 100),
    goalReach: round2(lost.length ? 100 * mean(lost.map((l) => l.avgGoalFrac)) : 100),
  };
  return {
    game: 'tidepool-pals',
    levels,
    measures,
    fitness: round2(mean(Object.values(measures))),
    hardFailures: levels.flatMap((l) => l.errors.map((e) => `level ${l.n}: ${e}`)),
  };
}
