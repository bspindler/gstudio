// Turns seeded casual Hyperline runs into per-sector stats and 0..100 measures. Each sector is played from its own start
// (createCourse(seed, sectorStart), as a practice run), so every sector gets the same sample and a change upstream
// doesn't reshuffle the sectors after it (measurement v2, P3). A course the search bot cannot clear is a hard failure,
// never a lower score.
import { createCourse, INTRO, PATTERNS } from '../../../../games/hyperline/lib/course.js';
import { SECTOR_LEN, sectorAt } from '../../../../games/hyperline/lib/world.js';
import { casualRun, clearable, HYPERLINE_CASUAL, SEARCH_BUDGET, type CasualRun, type Met } from './hyperline-bot.js';
import { bootstrapNoise } from './noise.js';
import { bandScore, tensionMeasure } from './tension.js';
import type { Measures, ScoreReport } from './types.js';

/**
 * One sector, played from its own start by every seed. `clears` / `nears`: spikes cleared, and cleared with a near miss
 * (the game's events). `close`: runs that got through the sector with at least one near miss (tension's close finishes).
 * `intro`: the sector's intro pattern, its kill rate per encounter (`bites`) and its p10 tap window, when it has one.
 * `windows`: p10 tap window (ms) of each pattern first seen in this sector, pooled over every sector it appears in.
 */
export type SectorStats = {
  sector: number; reached: number; died: number; deathRate: number; causes: Record<string, number>;
  clears: number; nears: number; close: number;
  intro?: { p: string; enc: number; kills: number; killRate: number };
  windows?: Record<string, number>;
};

/**
 * Brian-reviewed thresholds; changing them changes what "good" means. Every band is two-sided where
 * it can move, so a change that makes the game easier or emptier cannot raise the score.
 * - early: sectors 0..upTo need survival >= minSurvive (no upper bound: the opening may be gentle).
 * - later sectors need survival in [minSurvive, maxSurvive]; above maxSurvive is too easy.
 * - spikeJump: a death-rate rise between consecutive sectors that counts as a spike, judged only
 *   when both sectors were reached by >= minSample runs (fewer is seed luck, not a spike).
 * - reach: median casual distance / ref scores 100 inside [lo, hi], falling linearly to 0 at 0 and 1. `ref` is a fixed
 *   distance (the scored course length when the band was set, 2026-11-15), not `until`: the course grows by a sector
 *   at a time, and a fraction of a growing course would mark every new sector down whatever its quality.
 * - fair: each pattern's `quantile` (p10) tap window should be at least minMs (the plan's ~50 ms; the casual player's
 *   timing spread is 30 ms). Below it the pattern scores linearly less, 0 at a 0 ms window.
 * - bites: each sector's intro mechanic should kill the casual player on 3-25% of encounters: it is a real obstacle
 *   but not a wall (measurement v2 plan, approved 2026-11-15).
 */
export const HYPERLINE_BANDS = {
  early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, maxSurvive: 0.97, spikeJump: 0.3, minSample: 8,
  reach: { lo: 0.35, hi: 0.65, ref: 2650 },
  fair: { quantile: 0.1, minMs: 50 }, bites: [0.03, 0.25] as [number, number],
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)]!;

/** 0..100 for a median-distance fraction of reach.ref: 100 inside the reach band, linear to 0 at 0 and at 1. */
export function reachScore(frac: number): number {
  const { lo, hi } = HYPERLINE_BANDS.reach;
  const f = Math.min(1, Math.max(0, frac));
  if (f < lo) return (100 * f) / lo;
  if (f > hi) return (100 * (1 - f)) / (1 - hi);
  return 100;
}

/** inBand, noSpikes and reach from per-sector stats and the median distance as a fraction of reach.ref. */
export function sectorMeasures(levels: SectorStats[], reachFrac: number): Measures {
  const { early, minSurvive, maxSurvive, spikeJump, minSample } = HYPERLINE_BANDS;
  const inBandOk = (l: SectorStats): boolean => {
    if (l.reached === 0) return false;
    const survive = 1 - l.deathRate;
    return l.sector <= early.upTo ? survive >= early.minSurvive : survive >= minSurvive && survive <= maxSurvive;
  };
  const inBand = levels.filter(inBandOk).length;
  // Spikes are judged only between consecutive sectors each reached by >= minSample runs.
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

/** Tap windows by pattern. */
function windowsByPattern(ws: Met[]): Map<string, number[]> {
  const by = new Map<string, number[]>();
  for (const w of ws) if (w.p) { const a = by.get(w.p); if (a) a.push(w.ms); else by.set(w.p, [w.ms]); }
  return by;
}

/**
 * fair, 0..100: the mean over patterns met at least minSample times of min(100, 100 * p10 window / minMs). A window of
 * 0 (no tap clears the hazard from where the player stands) counts: that encounter was unfair. 100 if none qualify.
 */
export function fairScore(ws: Met[]): number {
  const { quantile: q, minMs } = HYPERLINE_BANDS.fair;
  const scores = [...windowsByPattern(ws).values()].filter((a) => a.length >= HYPERLINE_BANDS.minSample).map((a) => Math.min(100, (100 * quantile(a, q)) / minMs));
  return round2(scores.length ? mean(scores) : 100);
}

/** A sector's intro: encounters and kills of INTRO[s] by its runs, and the taps it asked for. */
function introOf(s: number, runs: CasualRun[]): { p: string; enc: number; kills: number; taps: number } | null {
  const p = INTRO[s];
  if (!p) return null;
  let enc = 0, kills = 0, taps = 0;
  for (const r of runs) {
    enc += r.enc[p] ?? 0;
    if (r.killer === p) kills++;
    for (const w of r.windows) if (w.p === p) taps++;
  }
  return { p, enc, kills, taps };
}

/**
 * bites, 0..100: the mean over sectors with an intro of bandScore(kills per encounter, bands.bites). An intro met fewer
 * than minSample times, or that asked for fewer than minSample taps, is not judged: low ceilings and jump pads are
 * "don't press" mechanics, and the casual player only presses for a hazard. 100 if none qualify.
 */
export function bitesScore(bySector: CasualRun[][]): number {
  const { minSample, bites } = HYPERLINE_BANDS;
  const scores: number[] = [];
  bySector.forEach((runs, s) => {
    const i = introOf(s, runs);
    if (i && i.enc >= minSample && i.taps >= minSample) scores.push(bandScore(i.kills / i.enc, bites));
  });
  return round2(scores.length ? mean(scores) : 100);
}

/** A seed's distance on the whole course, chaining its sector runs: where it died in the first sector it died in. */
export function chainedDist(bySector: CasualRun[][], i: number, until: number): number {
  for (const runs of bySector) if (runs[i]!.cause !== '') return runs[i]!.dist;
  return until;
}

function sectorStats(sector: number, runs: CasualRun[]): SectorStats {
  const deaths = runs.filter((r) => r.cause !== '');
  const causes: Record<string, number> = {};
  for (const d of deaths) causes[d.cause] = (causes[d.cause] ?? 0) + 1;
  const sum = (f: (r: CasualRun) => number) => runs.reduce((a, r) => a + f(r), 0);
  const out: SectorStats = {
    sector, reached: runs.length, died: deaths.length, deathRate: runs.length ? deaths.length / runs.length : 0, causes,
    clears: sum((r) => r.clears), nears: sum((r) => r.nears), close: runs.filter((r) => r.cause === '' && r.nears > 0).length,
  };
  const i = introOf(sector, runs);
  if (i) out.intro = { p: i.p, enc: i.enc, kills: i.kills, killRate: round2(i.enc ? i.kills / i.enc : 0) };
  return out;
}

export function scoreHyperline(range: { seeds: number; until: number }): ScoreReport<SectorStats> {
  const { seeds, until } = range;
  for (const [k, v] of [['seeds', seeds], ['until', until]] as const) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`scoreHyperline: ${k} must be a positive integer, got ${v}`);
  }
  const sectors = Array.from({ length: sectorAt(until - 1) + 1 }, (_, s) => ({ from: s * SECTOR_LEN, to: Math.min((s + 1) * SECTOR_LEN, until) }));
  const bySector = sectors.map(({ from, to }) => Array.from({ length: seeds }, (_, i) => casualRun(i + 1, to, HYPERLINE_CASUAL, from)));

  const measuresOf = (idx: number[]): { measures: Measures; fitness: number; levels: SectorStats[] } => {
    const sub = bySector.map((runs) => idx.map((i) => runs[i]!));
    const levels = sub.map((runs, s) => sectorStats(s, runs));
    const reach = median(idx.map((i) => chainedDist(bySector, i, until))) / HYPERLINE_BANDS.reach.ref;
    const measures: Measures = { ...sectorMeasures(levels, reach), fair: fairScore(sub.flat().flatMap((r) => r.windows)), bites: bitesScore(sub) };
    // Fitness stays the balance measures' mean; tension is reported and gated beside it (tension.ts, D1).
    const fitness = round2(mean(Object.values(measures)));
    measures.tension = tensionMeasure(levels.map((l) => ({ n: l.sector, wins: l.reached - l.died, close: l.close })), { skipUpTo: HYPERLINE_BANDS.early.upTo });
    return { measures, fitness, levels };
  };
  const all = Array.from({ length: seeds }, (_, i) => i);
  const { measures, fitness, levels } = measuresOf(all);
  // Each pattern's pooled p10 window, reported on the sector that introduces it, so the planner can see which is tight.
  const byP = windowsByPattern(bySector.flat().flatMap((r) => r.windows));
  for (const p of PATTERNS) {
    const a = byP.get(p.id), l = levels[p.sector];
    if (a && l) (l.windows ??= {})[p.id] = Math.round(quantile(a, HYPERLINE_BANDS.fair.quantile));
  }
  const noise = bootstrapNoise(seeds, (idx) => measuresOf(idx));

  const hardFailures: string[] = [];
  sectors.forEach(({ from, to }, s) => {
    for (let seed = 1; seed <= seeds; seed++) {
      if (bySector[s]![seed - 1]!.cause === '') continue; // the casual run got through this very course: it is clearable
      const ok = clearable(createCourse(seed, from), to, SEARCH_BUDGET, from);
      if (ok === false) hardFailures.push(`seed ${seed}, sector ${s}: not clearable from ${from}m to ${to}m`);
      else if (ok === 'unknown') hardFailures.push(`seed ${seed}, sector ${s}: clearability unknown`);
    }
  });
  return { game: 'hyperline', levels, measures, fitness, hardFailures, noise };
}
