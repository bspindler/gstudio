// Turns many robot plays into per-level stats and 0..100 measures. Invalid levels are hard failures, never a lower score.
import { difficulty, levelDef, validateLevel, withoutTides } from '../../../../games/tidepool-pals/levels.js';
import { playLevel } from './tidepool-bot.js';
import type { LevelStats, Measures, PlayResult, ScoreReport } from './types.js';
import { bootstrapNoise } from './noise.js';
import { tensionMeasure } from './tension.js';

/** A close Tidepool finish: won with at most this many moves left (or a tenth of the level's moves, if more). */
export const TIDEPOOL_CLOSE_MOVES = 2;

/** Brian-reviewed thresholds; changing them changes what "good" means. */
export const TIDEPOOL_BANDS = { early: { upTo: 5, minWin: 0.9 }, minWin: 0.25, wallDrop: 0.3 };

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

type LevelPlays = { n: number; def: ReturnType<typeof levelDef>; plays: PlayResult[]; errors: string[] };

function playsFor(n: number, seeds: number): LevelPlays {
  const def = levelDef(n);
  const plays = Array.from({ length: seeds }, (_, i) => playLevel(def, i + 1));
  const errors = [...new Set([...validateLevel(def), ...validateLevel(withoutTides(def))])];
  return { n, def, plays, errors };
}

/** A level's stats over the plays at seed indices `idx` (repeats allowed: the noise estimate resamples them). */
function statsOf({ n, def, plays: all, errors }: LevelPlays, idx: number[]): LevelStats {
  const plays = idx.map((i) => all[i]!);
  const close = Math.max(TIDEPOOL_CLOSE_MOVES, Math.ceil(def.moves * 0.1));
  const won = plays.filter((p) => p.won);
  return {
    n,
    wins: won.length,
    closeWins: won.filter((p) => p.movesLeft <= close).length,
    winRate: mean(plays.map((p) => (p.won ? 1 : 0))),
    avgMovesLeftFrac: mean(plays.map((p) => p.movesLeft / def.moves)),
    avgGoalFrac: mean(plays.map((p) => p.goalFrac)),
    difficulty: difficulty(def),
    errors,
  };
}

/** The measures and fitness from per-level stats. */
function measuresOf(levels: LevelStats[]): { measures: Measures; fitness: number } {
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
  // Fitness stays the balance measures' mean; tension is reported and gated beside it (tension.ts).
  const fitness = round2(mean(Object.values(measures)));
  measures.tension = tensionMeasure(levels.map((l) => ({ n: l.n, wins: l.wins ?? 0, close: l.closeWins ?? 0 })), { skipUpTo: early.upTo });
  return { measures, fitness };
}

export function scoreTidepool(opts: { from: number; to: number; seeds: number }): ScoreReport {
  const { from, to, seeds } = opts;
  if (![from, to, seeds].every(Number.isInteger)) throw new Error(`scoreTidepool: from, to and seeds must be integers, got ${from}, ${to}, ${seeds}`);
  if (from < 1) throw new Error(`scoreTidepool: from must be >= 1, got ${from}`);
  if (from > to) throw new Error(`scoreTidepool: empty level range ${from}..${to}`);
  if (seeds < 1) throw new Error(`scoreTidepool: seeds must be >= 1, got ${seeds}`);
  const played: LevelPlays[] = [];
  for (let n = opts.from; n <= opts.to; n++) played.push(playsFor(n, opts.seeds));
  const every = Array.from({ length: seeds }, (_, i) => i);
  const levels = played.map((p) => statsOf(p, every));
  const { measures, fitness } = measuresOf(levels);
  const noise = bootstrapNoise(seeds, (idx) => measuresOf(played.map((p) => statsOf(p, idx))));
  return {
    game: 'tidepool-pals',
    levels,
    measures,
    fitness,
    hardFailures: levels.flatMap((l) => l.errors.map((e) => `level ${l.n}: ${e}`)),
    noise,
  };
}
