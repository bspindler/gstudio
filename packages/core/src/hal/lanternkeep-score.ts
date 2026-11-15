// Turns bot plays of every Lanternkeep night (and Night Watch) into per-night stats and 0..100 measures.
// A broken night (bad path, unknown creature, unwinnable, or won by doing nothing) is a hard failure, never a
// lower score. The checks live here, not only in the game's tests, because Hal may edit the game's tests.
import { endlessLevel } from '../../../../games/lanternkeep/lib/endless.js';
import { LEVELS } from '../../../../games/lanternkeep/lib/levels.js';
import { PERKS, canTake, modsFor } from '../../../../games/lanternkeep/lib/meta.js';
import { COLS, ENEMIES, ROWS, TOWERS, TOWER_ORDER, pathCells, type Level, type Mods } from '../../../../games/lanternkeep/lib/sim.js';
import { LANTERNKEEP_STYLES, playLanternkeep, type LanternkeepBotOptions, type LanternkeepPlay } from './lanternkeep-bot.js';
import { bandScore, tensionMeasure } from './tension.js';
import { bootstrapNoise } from './noise.js';
import type { ScoreReport } from './types.js';

export type NightStats = {
  n: number; name: string; plays: number; wins: number; winRate: number;
  /** Wins with under half the lives left (operator decision D3, 2026-11-15): the close finishes tension counts. */
  closeWins: number; avgLivesFrac: number; errors: string[];
};

/**
 * Brian-reviewed thresholds (2026-11-13); changing them changes what "good" means.
 * - early: nights 1..upTo need a bot win rate >= minWin, with no upper bound (the opening should feel good).
 * - later nights need a win rate in [minWin, maxWin]; above maxWin is too easy.
 * - spikeDrop: a win-rate fall of more than this from one night to the next is a difficulty spike.
 * - watch: Night Watch's median wave reached, as a fraction of its waves, scores 100 inside [lo, hi]. Scored per
 *   style and averaged (measurement v2 P3), so every way of playing has to land in band, not just the pooled median.
 * Win rates are over every seed x style the bot plays, so "40%" means a sensible player loses some of the time.
 */
export const LANTERNKEEP_BANDS = {
  early: { upTo: 5, minWin: 0.9 }, minWin: 0.4, maxWin: 0.9, spikeDrop: 0.3,
  watch: { lo: 0.3, hi: 0.6 },
};

/**
 * Stars a typical player has earned per night played before this one (measurement v2 P2). Each star is a spark, and
 * the scorer plays every night with the perks those sparks buy, as a player would.
 */
export const TYPICAL_STARS_PER_NIGHT = 2;

/**
 * Night Watch's safety stop, in simulated seconds. The bot's default 40 minutes ended runs at wave 43 with the lantern
 * still lit, so "reach" was the stop, not the player. Six hours is far past where any style falls today (wave ~55).
 */
export const WATCH_MAX_SECONDS = 6 * 3600;

export const LANTERNKEEP_DEFAULTS = { seeds: 12 }; // 4 until measurement v2 P1.3 (2026-11-15): win rates moved in quarter steps

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

/**
 * The perks a player with `stars` sparks owns: the perk screen's list taken top to bottom, each one lit when the sparks
 * left cover it (the game's own spark rules, meta.js). Perks reset for free, so this is a fresh pick at any point.
 */
export function typicalPerks(stars: number): string[] {
  const owned: string[] = [];
  for (const p of PERKS) if (canTake(stars, owned, p.id)) owned.push(p.id);
  return owned;
}

/** The mods night `n` (1-based) is played with: the perks of TYPICAL_STARS_PER_NIGHT stars per earlier night. */
export function nightPerks(n: number): Mods {
  return modsFor(typicalPerks(TYPICAL_STARS_PER_NIGHT * Math.max(0, n - 1)));
}

/** Night Watch is the endgame: it is played with the perks of a typical player who has finished every night. */
export const watchPerks = (): Mods => modsFor(typicalPerks(TYPICAL_STARS_PER_NIGHT * LEVELS.length));

/** A close win (operator decision D3): won, with under half the lives left (one-star territory). */
export function isCloseWin(p: LanternkeepPlay): boolean {
  return p.won && p.lives < p.maxLives / 2;
}

/** One Night Watch play, run until the lantern falls (or WATCH_MAX_SECONDS). */
export function playWatch(style: LanternkeepBotOptions, seed: number, watch: Level = endlessLevel()): LanternkeepPlay {
  return playLanternkeep(watch, { ...style, seed, mods: watchPerks(), maxSeconds: WATCH_MAX_SECONDS });
}

function plays(level: Level, seeds: number, mods: Mods, maxSeconds?: number): LanternkeepPlay[] {
  const out: LanternkeepPlay[] = [];
  for (let s = 1; s <= seeds; s++) {
    for (const style of LANTERNKEEP_STYLES) out.push(playLanternkeep(level, { ...style, seed: s, mods, ...(maxSeconds ? { maxSeconds } : {}) }));
  }
  return out;
}

/**
 * The measures from per-night stats and Night Watch's reach (a fraction of its waves): one number, or one per style,
 * each band-scored and averaged.
 */
export function nightMeasures(nights: NightStats[], watchFrac: number | number[]): Record<string, number> {
  const B = LANTERNKEEP_BANDS;
  const ok = (l: NightStats) => (l.n <= B.early.upTo ? l.winRate >= B.early.minWin : l.winRate >= B.minWin && l.winRate <= B.maxWin);
  let spikes = 0;
  for (let i = 1; i < nights.length; i++) if (nights[i - 1]!.winRate - nights[i]!.winRate > B.spikeDrop) spikes++;
  const pairs = Math.max(0, nights.length - 1);
  return {
    inBand: round2(nights.length ? (100 * nights.filter(ok).length) / nights.length : 100),
    noSpikes: round2(pairs ? 100 * (1 - spikes / pairs) : 100),
    watch: round2(mean((Array.isArray(watchFrac) ? watchFrac : [watchFrac]).map((f) => bandScore(f, [B.watch.lo, B.watch.hi])))),
  };
}

export function scoreLanternkeep(range: { seeds: number } = LANTERNKEEP_DEFAULTS): ScoreReport<NightStats> {
  const { seeds } = range;
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error(`scoreLanternkeep: seeds must be a positive integer, got ${seeds}`);
  const hardFailures: string[] = [];
  const perStyle = LANTERNKEEP_STYLES.length;
  // Plays are seed-major (seed 1's styles, then seed 2's, ...), so seed index i owns plays [i*perStyle, (i+1)*perStyle).
  const pick = (ps: LanternkeepPlay[], idx: number[]): LanternkeepPlay[] => idx.flatMap((i) => ps.slice(i * perStyle, (i + 1) * perStyle));
  const played: Array<{ n: number; name: string; ps: LanternkeepPlay[]; errors: string[] }> = [];
  LEVELS.forEach((level, i) => {
    const n = i + 1;
    const errors = lanternkeepProblems(level);
    for (const e of errors) hardFailures.push(`night ${n}: ${e}`);
    if (errors.length) { played.push({ n, name: level.name, ps: [], errors }); return; }
    const mods = nightPerks(n);
    const ps = plays(level, seeds, mods);
    if (!ps.some((p) => p.won)) hardFailures.push(`night ${n}: no bot style or seed can win it`);
    if (playLanternkeep(level, { maxTowers: 0, mods }).won) hardFailures.push(`night ${n}: won by planting nothing`);
    played.push({ n, name: level.name, ps, errors: [] });
  });
  const nightsOf = (idx: number[]): NightStats[] => played.map(({ n, name, ps: all, errors }) => {
    if (errors.length) return { n, name, plays: 0, wins: 0, winRate: 0, closeWins: 0, avgLivesFrac: 0, errors };
    const ps = pick(all, idx);
    const wins = ps.filter((p) => p.won);
    return {
      n, name, plays: ps.length, wins: wins.length, winRate: round2(wins.length / ps.length),
      closeWins: wins.filter(isCloseWin).length,
      avgLivesFrac: round2(mean(ps.map((p) => p.lives / p.maxLives))), errors: [],
    };
  });

  const watch = endlessLevel();
  const watchProblems = lanternkeepProblems(watch);
  for (const e of watchProblems) hardFailures.push(`night watch: ${e}`);
  const watchPlays = watchProblems.length ? [] : plays(watch, seeds, watchPerks(), WATCH_MAX_SECONDS);
  // Per style: style k's plays sit at k, k + perStyle, ... within each seed's block.
  const watchFracOf = (idx: number[]): number[] => {
    if (watchProblems.length) return [0];
    const ps = pick(watchPlays, idx);
    return LANTERNKEEP_STYLES.map((_, k) => median(ps.filter((_, j) => j % perStyle === k).map((p) => p.wave)) / watch.waves.length);
  };

  const measuresOf = (idx: number[]): { measures: Record<string, number>; fitness: number } => {
    const ns = nightsOf(idx);
    const measures = nightMeasures(ns.filter((l) => !l.errors.length), watchFracOf(idx));
    // Fitness stays the balance measures' mean; tension is reported and gated beside it (tension.ts).
    const fitness = round2(mean(Object.values(measures)));
    measures.tension = tensionMeasure(ns.map((l) => ({ n: l.n, wins: l.wins, close: l.closeWins })), { skipUpTo: LANTERNKEEP_BANDS.early.upTo });
    return { measures, fitness };
  };
  const every = Array.from({ length: seeds }, (_, i) => i);
  const nights = nightsOf(every);
  const { measures, fitness } = measuresOf(every);
  const noise = bootstrapNoise(seeds, measuresOf);
  return { game: 'lanternkeep', levels: nights, measures, fitness, hardFailures, noise };
}
