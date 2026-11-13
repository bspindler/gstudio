// Turns bot plays of every Lanternkeep night (and Night Watch) into per-night stats and 0..100 measures.
// A broken night (bad path, unknown creature, unwinnable, or won by doing nothing) is a hard failure, never a
// lower score. The checks live here, not only in the game's tests, because Hal may edit the game's tests.
import { endlessLevel } from '../../../../games/lanternkeep/lib/endless.js';
import { LEVELS } from '../../../../games/lanternkeep/lib/levels.js';
import { COLS, ENEMIES, ROWS, TOWERS, TOWER_ORDER, pathCells, type Level } from '../../../../games/lanternkeep/lib/sim.js';
import { LANTERNKEEP_STYLES, playLanternkeep, type LanternkeepPlay } from './lanternkeep-bot.js';
import { bandScore, tensionMeasure } from './tension.js';
import type { ScoreReport } from './types.js';

export type NightStats = {
  n: number; name: string; plays: number; wins: number; winRate: number;
  /** Wins that lost enough lives to miss three stars: the close finishes tension counts. */
  closeWins: number; avgLivesFrac: number; errors: string[];
};

/**
 * Brian-reviewed thresholds (2026-11-13); changing them changes what "good" means.
 * - early: nights 1..upTo need a bot win rate >= minWin, with no upper bound (the opening should feel good).
 * - later nights need a win rate in [minWin, maxWin]; above maxWin is too easy.
 * - spikeDrop: a win-rate fall of more than this from one night to the next is a difficulty spike.
 * - watch: Night Watch's median wave reached, as a fraction of its waves, scores 100 inside [lo, hi].
 * Win rates are over every seed x style the bot plays, so "40%" means a sensible player loses some of the time.
 */
export const LANTERNKEEP_BANDS = {
  early: { upTo: 5, minWin: 0.9 }, minWin: 0.4, maxWin: 0.9, spikeDrop: 0.3,
  watch: { lo: 0.3, hi: 0.6 },
};

export const LANTERNKEEP_DEFAULTS = { seeds: 4 };

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Structural problems with a night, as readable strings. Empty means it is playable. */
export function lanternkeepProblems(level: Level): string[] {
  const out: string[] = [];
  if (!level.paths?.length) return ['no paths'];
  const p0 = level.paths[0]!;
  const end = p0[p0.length - 1]!;
  level.paths.forEach((p, i) => {
    if (p.length < 2) { out.push(`path ${i + 1} has fewer than two points`); return; }
    const last = p[p.length - 1]!;
    if (last[0] !== end[0] || last[1] !== end[1]) out.push(`path ${i + 1} does not end on the lantern`);
    if (end[0] < 0 || end[0] >= COLS || end[1] < 0 || end[1] >= ROWS) out.push('the lantern is off the board');
    const [c0, r0] = p[0]!;
    if (!(c0 < 0 || c0 >= COLS || r0 < 0 || r0 >= ROWS)) out.push(`path ${i + 1} does not start off the board`);
    for (let k = 1; k < p.length; k++) if (p[k]![0] !== p[k - 1]![0] && p[k]![1] !== p[k - 1]![1]) out.push(`path ${i + 1} has a diagonal step at point ${k + 1}`);
    const cells = pathCells(p).map(([c, r]) => `${c},${r}`);
    if (new Set(cells).size !== cells.length) out.push(`path ${i + 1} crosses itself`);
  });
  if (!level.waves?.length) out.push('no waves');
  for (const w of level.waves ?? []) {
    if (!w.length) out.push('an empty wave');
    for (const [type, count, gap] of w) {
      if (!(type in ENEMIES)) out.push(`unknown creature ${String(type)}`);
      if (!Number.isFinite(count) || count < 1 || !Number.isFinite(gap) || gap < 0) out.push(`bad group for ${String(type)}`);
    }
  }
  if (!level.towers?.length || level.towers.some((t) => !TOWER_ORDER.includes(t))) out.push('unknown or missing plants');
  else if (level.gold < Math.min(...level.towers.map((t) => TOWERS[t].tiers[0]!.cost))) out.push('not enough starting gold for any plant');
  if (!(level.lives >= 1)) out.push('no lives');
  return out;
}

function plays(level: Level, seeds: number): LanternkeepPlay[] {
  const out: LanternkeepPlay[] = [];
  for (let s = 1; s <= seeds; s++) for (const style of LANTERNKEEP_STYLES) out.push(playLanternkeep(level, { ...style, seed: s }));
  return out;
}

/** The measures from per-night stats and Night Watch's median reach (a fraction of its waves). */
export function nightMeasures(nights: NightStats[], watchFrac: number): Record<string, number> {
  const B = LANTERNKEEP_BANDS;
  const ok = (l: NightStats) => (l.n <= B.early.upTo ? l.winRate >= B.early.minWin : l.winRate >= B.minWin && l.winRate <= B.maxWin);
  let spikes = 0;
  for (let i = 1; i < nights.length; i++) if (nights[i - 1]!.winRate - nights[i]!.winRate > B.spikeDrop) spikes++;
  const pairs = Math.max(0, nights.length - 1);
  return {
    inBand: round2(nights.length ? (100 * nights.filter(ok).length) / nights.length : 100),
    noSpikes: round2(pairs ? 100 * (1 - spikes / pairs) : 100),
    watch: round2(bandScore(watchFrac, [B.watch.lo, B.watch.hi])),
  };
}

export function scoreLanternkeep(range: { seeds: number } = LANTERNKEEP_DEFAULTS): ScoreReport<NightStats> {
  const { seeds } = range;
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error(`scoreLanternkeep: seeds must be a positive integer, got ${seeds}`);
  const hardFailures: string[] = [];
  const nights: NightStats[] = [];
  LEVELS.forEach((level, i) => {
    const n = i + 1;
    const errors = lanternkeepProblems(level);
    for (const e of errors) hardFailures.push(`night ${n}: ${e}`);
    if (errors.length) { nights.push({ n, name: level.name, plays: 0, wins: 0, winRate: 0, closeWins: 0, avgLivesFrac: 0, errors }); return; }
    const ps = plays(level, seeds);
    const wins = ps.filter((p) => p.won);
    if (!wins.length) hardFailures.push(`night ${n}: no bot style or seed can win it`);
    if (playLanternkeep(level, { maxTowers: 0 }).won) hardFailures.push(`night ${n}: won by planting nothing`);
    nights.push({
      n, name: level.name, plays: ps.length, wins: wins.length, winRate: round2(wins.length / ps.length),
      closeWins: wins.filter((p) => p.stars < 3).length,
      avgLivesFrac: round2(mean(ps.map((p) => p.lives / p.maxLives))), errors: [],
    });
  });

  const watch = endlessLevel();
  const watchProblems = lanternkeepProblems(watch);
  for (const e of watchProblems) hardFailures.push(`night watch: ${e}`);
  const watchFrac = watchProblems.length ? 0 : median(plays(watch, seeds).map((p) => p.wave)) / watch.waves.length;

  const measures = nightMeasures(nights.filter((l) => !l.errors.length), watchFrac);
  // Fitness stays the balance measures' mean; tension is reported and gated beside it (tension.ts).
  const fitness = round2(mean(Object.values(measures)));
  measures.tension = tensionMeasure(nights.map((l) => ({ wins: l.wins, close: l.closeWins })));
  return { game: 'lanternkeep', levels: nights, measures, fitness, hardFailures };
}
