// Turns many robot plays into per-level stats and 0..100 measures. Invalid levels are hard failures, never a lower score.
//
// Measures (measurement v2, operator-approved 2026-11-15). Fitness is the mean of all but tension, which is soft:
//   inBand    each level's win rate scored continuously against its tier's band (bandScore), averaged. Past the
//             opening the band has a ceiling: a level nobody loses is not a level.
//   noWalls   no level's win rate falls more than wallDrop below the one before it.
//   goalReach how near the losses came, only on levels below their band (where nearer losses are a step toward the
//             band); in band or above it a level scores 100. Near-miss losses are never rewarded on their own: building
//             levels to lose narrowly is the lever that sells a continue, a dark pattern (hard rule 4).
//   variety   neighbouring levels differ in goals, board shape and mechanics (levels.js data, no plays, no noise).
//   tension   close finishes among wins (tension.ts), past the opening.
//
// Beside fitness, never a measure: `plusFive`, the share of losses 5 more moves would turn into wins, and per level
// `plusFiveHelps`, whether the paid '+5 Moves' offer helps enough to show there. It only decides where the offer hides.
// As a measure it would reward levels tuned to lose narrowly, the lever that sells the continue (hard rule 4), so it
// sits outside `measures`: no ticket can target it and no gate can keep or discard a change on it.
// A level gets no +5 verdict where the robot's losses don't respond to moves (`botStuck`: given the level's moves
// again, it still wins under half of them): there its losses are the robot's blind spot (it plans one move ahead, so
// clearing a path for a stranded pal is valued only once the pal moves), and the verdict would describe the robot.
import type { LevelDef } from '../../../../games/tidepool-pals/board.js';
import { difficulty, features, levelDef, validateLevel, withoutTides } from '../../../../games/tidepool-pals/levels.js';
import { playLevel, type TidepoolPlay } from './tidepool-bot.js';
import type { LevelStats, Measures, ScoreReport } from './types.js';
import { bootstrapNoise } from './noise.js';
import { bandScore, tensionMeasure } from './tension.js';

/** A close Tidepool finish: won with at most this many moves left (or a tenth of the level's moves, if more). */
export const TIDEPOOL_CLOSE_MOVES = 2;

/**
 * Brian-reviewed thresholds; changing them changes what "good" means.
 * tiers: win-rate band by level number (the last tier whose `from` is at most n).
 * plusFive: `moves` added on replay; a level needs at least `minLossRate` losses to be judged; the offer `helps` when it
 *   turns at least that share of losses into wins (worse than 1 in 5 is a poor buy); a level scores 100 at `target`;
 *   no verdict when the level's moves doubled turn under `botMinConverted` of the robot's losses into wins.
 * variety: a neighbouring pair scores 100 once it differs in `target` of its tags (Jaccard distance).
 */
export const TIDEPOOL_BANDS = {
  early: { upTo: 5 },
  tiers: [
    { from: 1, band: [0.9, 1] as [number, number] },
    { from: 6, band: [0.7, 0.95] as [number, number] },
    { from: 16, band: [0.45, 0.85] as [number, number] },
  ],
  wallDrop: 0.3,
  plusFive: { moves: 5, minLossRate: 0.05, helps: 0.2, target: 0.5, botMinConverted: 0.5 },
  variety: { target: 0.5 },
};

/**
 * Per-level stats: the shared ones plus the +5 and doubled-moves replays. `plusFiveHelps` null: no verdict (too few
 * losses for the offer to matter, or `botStuck`). `botStuck` null: too few losses to judge.
 */
export type TidepoolLevelStats = LevelStats & {
  lossGoalFrac: number; winRatePlusFive: number; winRateDoubled: number; plusFiveHelps: boolean | null; botStuck: boolean | null;
};
/** The report: `plusFive` sits beside fitness (0..100, mean over levels with a +5 verdict; 100 when none has one). */
export type TidepoolReport = ScoreReport<TidepoolLevelStats> & { plusFive: number };

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function tierBand(n: number): [number, number] {
  let band = TIDEPOOL_BANDS.tiers[0]!.band;
  for (const t of TIDEPOOL_BANDS.tiers) if (n >= t.from) band = t.band;
  return [...band];
}

export function inBandOf(n: number, winRate: number): number {
  return bandScore(winRate, tierBand(n));
}

/** 100 at or above the band's floor; below it, how near the losses came (mean goal fraction of lost plays). */
export function goalReachOf(n: number, winRate: number, lossGoalFrac: number): number {
  return winRate >= tierBand(n)[0] ? 100 : 100 * lossGoalFrac;
}

/**
 * The +5 verdict for one level from its win rate, with 5 more moves, and with its moves doubled. No verdict (nulls)
 * when too few plays are lost to matter, or when the robot is stuck: doubling its moves wins under `botMinConverted`
 * of its losses, so what +5 does there says more about the robot than about the level.
 */
export function plusFiveOf(winRate: number, winRatePlusFive: number, winRateDoubled: number): { helps: boolean | null; score: number | null; botStuck: boolean | null } {
  const { minLossRate, helps, target, botMinConverted } = TIDEPOOL_BANDS.plusFive;
  const lossRate = 1 - winRate;
  if (lossRate < minLossRate - 1e-9) return { helps: null, score: null, botStuck: null };
  if (Math.max(0, winRateDoubled - winRate) / lossRate < botMinConverted - 1e-9) return { helps: null, score: null, botStuck: true };
  const converted = Math.max(0, winRatePlusFive - winRate) / lossRate;
  return { helps: converted >= helps, score: Math.min(100, (100 * converted) / target), botStuck: false };
}

/** What a player notices about a level: its goal types, board shape and mechanics. */
export function levelTags(def: LevelDef): string[] {
  const f = features(def);
  const tags = new Set(def.goals.map((g) => `goal:${g.t}`));
  const has = (ch: string) => def.layout.some((row) => row.includes(ch));
  for (const k of ['sand', 'litter', 'ice', 'rock'] as const) if (f[k] > 0) tags.add(k);
  if (has('P')) { tags.add('stranded'); tags.add(`exit:${def.exit ?? 'none'}`); }
  if (has('B')) tags.add('bubble');
  tags.add(def.tide ? `tide:${def.tide.dir}` : 'tide:none');
  tags.add(f.holes > 0 ? `shape:${def.layout.map((row) => row.replace(/[^x]/g, '.')).join('/')}` : 'shape:full');
  tags.add(`colors:${def.colors}`);
  return [...tags].sort();
}

/** Mean over neighbouring pairs (past the opening) of how different they are; 100 when there is no pair to judge. */
export function varietyScore(defs: LevelDef[]): number {
  const scores: number[] = [];
  for (let i = 1; i < defs.length; i++) {
    if (defs[i]!.n <= TIDEPOOL_BANDS.early.upTo) continue;
    const a = new Set(levelTags(defs[i - 1]!)), b = levelTags(defs[i]!);
    const both = b.filter((t) => a.has(t)).length;
    const distance = 1 - both / (a.size + b.length - both);
    scores.push(Math.min(100, (100 * distance) / TIDEPOOL_BANDS.variety.target));
  }
  return scores.length ? mean(scores) : 100;
}

type LevelPlays = { n: number; def: LevelDef; plays: TidepoolPlay[]; errors: string[] };

function playsFor(n: number, seeds: number): LevelPlays {
  const def = levelDef(n);
  const extra = TIDEPOOL_BANDS.plusFive.moves;
  const plays = Array.from({ length: seeds }, (_, i) => playLevel(def, i + 1, undefined, { extra, more: Math.max(extra, def.moves) }));
  const errors = [...new Set([...validateLevel(def), ...validateLevel(withoutTides(def))])];
  return { n, def, plays, errors };
}

/** A level's stats over the plays at seed indices `idx` (repeats allowed: the noise estimate resamples them). */
function statsOf({ n, def, plays: all, errors }: LevelPlays, idx: number[]): TidepoolLevelStats {
  const plays = idx.map((i) => all[i]!);
  const close = Math.max(TIDEPOOL_CLOSE_MOVES, Math.ceil(def.moves * 0.1));
  const won = plays.filter((p) => p.won);
  const lost = plays.filter((p) => !p.won);
  const winRate = mean(plays.map((p) => (p.won ? 1 : 0)));
  const winRatePlusFive = mean(plays.map((p) => (p.wonWithExtra ? 1 : 0)));
  const winRateDoubled = mean(plays.map((p) => (p.wonWithMore ? 1 : 0)));
  const five = plusFiveOf(winRate, winRatePlusFive, winRateDoubled);
  return {
    n,
    wins: won.length,
    closeWins: won.filter((p) => p.movesLeft <= close).length,
    winRate,
    avgMovesLeftFrac: mean(plays.map((p) => p.movesLeft / def.moves)),
    avgGoalFrac: mean(plays.map((p) => p.goalFrac)),
    lossGoalFrac: lost.length ? mean(lost.map((p) => p.goalFrac)) : 1,
    winRatePlusFive,
    winRateDoubled,
    plusFiveHelps: five.helps,
    botStuck: five.botStuck,
    difficulty: difficulty(def),
    errors,
  };
}

/** The measures and fitness from per-level stats; `variety` is fixed by the level data. */
function measuresOf(levels: TidepoolLevelStats[], variety: number): { measures: Measures; fitness: number } {
  const { early, wallDrop } = TIDEPOOL_BANDS;
  let walls = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i - 1]!.winRate - levels[i]!.winRate > wallDrop) walls++;
  const measures: Measures = {
    inBand: round2(levels.length ? mean(levels.map((l) => inBandOf(l.n, l.winRate))) : 0),
    noWalls: round2(levels.length > 1 ? 100 * (1 - walls / (levels.length - 1)) : 100),
    goalReach: round2(levels.length ? mean(levels.map((l) => goalReachOf(l.n, l.winRate, l.lossGoalFrac))) : 100),
    variety: round2(variety),
  };
  // Fitness stays the balance measures' mean; tension is reported and gated beside it (tension.ts).
  const fitness = round2(mean(Object.values(measures)));
  measures.tension = tensionMeasure(levels.map((l) => ({ n: l.n, wins: l.wins ?? 0, close: l.closeWins ?? 0 })), { skipUpTo: early.upTo });
  return { measures, fitness };
}

/** Beside fitness, never in it: the mean +5 score over levels with a verdict. */
function plusFiveScore(levels: TidepoolLevelStats[]): number {
  const five = levels.map((l) => plusFiveOf(l.winRate, l.winRatePlusFive, l.winRateDoubled).score).filter((s): s is number => s !== null);
  return round2(five.length ? mean(five) : 100);
}

export function scoreTidepool(opts: { from: number; to: number; seeds: number }): TidepoolReport {
  const { from, to, seeds } = opts;
  if (![from, to, seeds].every(Number.isInteger)) throw new Error(`scoreTidepool: from, to and seeds must be integers, got ${from}, ${to}, ${seeds}`);
  if (from < 1) throw new Error(`scoreTidepool: from must be >= 1, got ${from}`);
  if (from > to) throw new Error(`scoreTidepool: empty level range ${from}..${to}`);
  if (seeds < 1) throw new Error(`scoreTidepool: seeds must be >= 1, got ${seeds}`);
  const played: LevelPlays[] = [];
  for (let n = opts.from; n <= opts.to; n++) played.push(playsFor(n, opts.seeds));
  const variety = varietyScore(played.map((p) => p.def));
  const every = Array.from({ length: seeds }, (_, i) => i);
  const levels = played.map((p) => statsOf(p, every));
  const { measures, fitness } = measuresOf(levels, variety);
  const noise = bootstrapNoise(seeds, (idx) => measuresOf(played.map((p) => statsOf(p, idx)), variety));
  return {
    game: 'tidepool-pals',
    levels,
    measures,
    fitness,
    plusFive: plusFiveScore(levels),
    hardFailures: levels.flatMap((l) => l.errors.map((e) => `level ${l.n}: ${e}`)),
    noise,
  };
}
