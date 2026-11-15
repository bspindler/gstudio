// Scores Gearhold gunplay from robot play records (browser runs). Two-sided so a softer, emptier or more generous game never scores higher.
// Every level gets its own 0-100 scores (bandScore, tension.ts), and each measure is the mean over levels (measurement
// v2 P3): a level just out of band costs a few points instead of a 25-point step, and the gate can hold each level's
// scores on their own when a new level arrives (gate.ts, the new-level path). The map walker's structural checks
// (gearhold-walk.ts) are hard failures here, so the static scorer can leave the gate's fitness without letting a broken
// map through.
import { LEVELS } from '../../../../games/gearhold/levels.js';
import { walkLevel } from './gearhold-walk.js';
import { bootstrapNoise } from './noise.js';
import type { Measures, ScoreReport } from './types.js';
import { bandScore, tensionMeasure } from './tension.js';

/** A close Gearhold win: finished with at most this much health (of 100). */
export const GEARHOLD_CLOSE_HP = 35;

/** The one place the default play range is set; scorers and the direct runner both read it. */
/** Seeds per level. The level count is not fixed here: the scorer plays every level the game has (scorers.ts). */
export const GEARHOLD_PLAY_DEFAULTS = { seeds: 150, seedBase: 0 } as const; // 50 until measurement v2 P1.3 (2026-11-15)

/** The player's top walking speed, tiles/s (index.html maxSp): turns the walker's route into a walk time (paceRatio, reported only). */
export const GEARHOLD_RUN_SPEED = 3.6;

export type PlayRecord = {
  level: number; /* 0-based, the game's own index */ seed: number; result: 'win' | 'dead' | 'timeout'; time: number; hpLeft: number;
  kills: number; foes: number; shotsFired: number; hits: number; damageTaken: number; damageUnseen: number; cause: string;
};

/** A level's balance scores, each 0-100; the report's measures of the same names are their means over levels. */
export type LevelScores = { winnable: number; fairDamage: number; pace: number; feel: number };

export type LevelPlayStats = {
  level: number; n: number; winRate: number;
  medianWinTime: number | null; // seconds, over wins only; null when nothing won
  hitRatio: number;             // median hits / shotsFired over the level's runs
  unseenShare: number;          // damageUnseen / max(1, damageTaken)
  wins: number; closeWins: number; // wins, and wins at GEARHOLD_CLOSE_HP or less (tension.ts)
  routeTiles: number | null;    // the map walker's route, start to exit, in tiles; null when it has none
  paceRatio: number | null;     // medianWinTime / (routeTiles / GEARHOLD_RUN_SPEED); data only, not scored; null without a win or a route
  scores: LevelScores;
  /** Seed noise (standard error, score points) of each of this level's scores; the gate's new-level path reads it. */
  noise?: Measures;
};

/**
 * Brian-reviewed bands; changing them changes what "good" means. Win rate: first level (index 0) vs later levels.
 * Pace: the median win time in seconds against [30, 180], per level with bandScore (measurement v2 P3): under 30 s it
 * loses points in proportion (15 s scores 50), past 180 s it falls to 0 at `winSecondsZero`, twice the cap, as
 * bandScore does for a rate at 1. The walker's route and the pace ratio (win time over the route's walk time) are
 * reported per level as data for a proposed ratio band; they are not scored until the operator signs one off.
 */
export const GEARHOLD_PLAY_BANDS = {
  firstWin: [0.8, 1.0] as [number, number],
  laterWin: [0.5, 0.9] as [number, number],
  winSeconds: [30, 180] as [number, number],
  winSecondsZero: 360,
  hitRatio: [0.35, 0.8] as [number, number],
};

export type GearholdPlayOptions = {
  /** Maps by 0-based level index (default: the game's own LEVELS): the walker's route and structural checks. */
  maps?: readonly (readonly string[])[];
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
// Defensive clamp: the hook counts one hit per trigger pull, so hits should not exceed shotsFired.
const ratio = (r: PlayRecord): number => (r.shotsFired > 0 ? Math.max(0, Math.min(1, r.hits / r.shotsFired)) : 0);

/** A level's pace score: its median win time against the seconds band, scaled so bandScore reaches 0 at winSecondsZero. */
function paceScore(winTime: number | null): number {
  if (winTime === null) return 0;
  const B = GEARHOLD_PLAY_BANDS, z = B.winSecondsZero;
  return bandScore(winTime / z, [B.winSeconds[0] / z, B.winSeconds[1] / z]);
}

type MapInfo = Map<number, { routeTiles: number | null; problems: string[] }>;

export function scoreGearholdPlay(records: PlayRecord[], opts: GearholdPlayOptions = {}): ScoreReport<LevelPlayStats> {
  if (records.length === 0) throw new Error('scoreGearholdPlay: no play records');
  const maps = opts.maps ?? LEVELS.map((l) => l.map);
  // Walk each played level's map once: its route gives the reported pace ratio, its problems are hard failures.
  const info: MapInfo = new Map();
  for (const level of new Set(records.map((r) => r.level).filter((l) => Number.isInteger(l)))) {
    const map = maps[level];
    if (!map) { info.set(level, { routeTiles: null, problems: ['no map'] }); continue; }
    const w = walkLevel([...map]);
    info.set(level, { routeTiles: w.route.length > 1 ? w.route.length - 1 : null, problems: w.problems });
  }
  const report = scoreRecords(records, info);
  for (const [level, m] of [...info].sort((a, b) => a[0] - b[0])) for (const p of m.problems) report.hardFailures.push(`level ${level + 1}: ${p}`);
  if (!report.levels.length) return report;
  // Seed noise: resample whole seeds (each seed's runs on every level together) and re-score, the measures and each
  // level's scores (keys "<level>:<score>") in one pass.
  const valid = records.filter((r) => Number.isFinite(r.seed) && ['win', 'dead', 'timeout'].includes(r.result));
  const seeds = [...new Set(valid.map((r) => r.seed))].sort((a, b) => a - b);
  const bySeed = new Map(seeds.map((sd) => [sd, valid.filter((r) => r.seed === sd)]));
  const all = bootstrapNoise(seeds.length, (idx) => {
    const r = scoreRecords(idx.flatMap((i) => bySeed.get(seeds[i]!)!), info);
    const per = r.levels.flatMap((l) => Object.entries(l.scores).map(([k, v]) => [`${l.level}:${k}`, v] as const));
    return { measures: { ...r.measures, ...Object.fromEntries(per) }, fitness: r.fitness };
  });
  const noise: Measures = {};
  const levelNoise = new Map<number, Measures>();
  for (const [k, v] of Object.entries(all)) {
    const i = k.indexOf(':');
    if (i < 0) { noise[k] = v; continue; }
    const level = Number(k.slice(0, i));
    levelNoise.set(level, { ...levelNoise.get(level), [k.slice(i + 1)]: v });
  }
  const levels = report.levels.map((l) => (levelNoise.has(l.level) ? { ...l, noise: levelNoise.get(l.level)! } : l));
  return { ...report, levels, noise };
}

function scoreRecords(records: PlayRecord[], info: MapInfo): ScoreReport<LevelPlayStats> {
  const B = GEARHOLD_PLAY_BANDS;
  const hardFailures: string[] = [];
  const all = records;
  records = all.filter((r, i) => {
    let bad = false;
    for (const k of ['level', 'seed', 'time', 'hpLeft', 'kills', 'foes', 'shotsFired', 'hits', 'damageTaken', 'damageUnseen'] as const)
      if (!Number.isFinite(r[k])) { hardFailures.push(`record ${i} (level ${r.level}, seed ${r.seed}): ${k} is not finite`); bad = true; }
    if (!['win', 'dead', 'timeout'].includes(r.result)) { hardFailures.push(`record ${i} (level ${r.level}, seed ${r.seed}): invalid result "${String(r.result)}"`); bad = true; }
    return !bad;
  }); // invalid records are excluded from the measures and reported as hard failures
  if (records.length === 0)
    return { game: 'gearhold-play', levels: [], measures: { winnable: 0, fairDamage: 0, pace: 0, feel: 0, tension: 0 }, fitness: 0, hardFailures };

  const byLevel = new Map<number, PlayRecord[]>();
  for (const r of records) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
  const levels: LevelPlayStats[] = [...byLevel.keys()].sort((a, b) => a - b).map((level) => {
    const rs = byLevel.get(level)!;
    const wins = rs.filter((r) => r.result === 'win');
    const taken = rs.reduce((s, r) => s + r.damageTaken, 0);
    const unseen = rs.reduce((s, r) => s + r.damageUnseen, 0);
    const winRate = wins.length / rs.length;
    const medianWinTime = wins.length ? median(wins.map((r) => r.time)) : null;
    const hitRatio = median(rs.map(ratio));
    const routeTiles = info.get(level)?.routeTiles ?? null;
    const paceRatio = medianWinTime !== null && routeTiles ? medianWinTime / (routeTiles / GEARHOLD_RUN_SPEED) : null;
    const scores: LevelScores = {
      winnable: round2(bandScore(winRate, level === 0 ? B.firstWin : B.laterWin)),
      // fairDamage is one-sided by definition (less unseen damage always raises it); the other measures offset that.
      fairDamage: round2(Math.max(0, Math.min(100, 100 * (1 - unseen / Math.max(1, taken))))),
      pace: round2(paceScore(medianWinTime)),
      feel: round2(bandScore(hitRatio, B.hitRatio)),
    };
    return {
      level, n: rs.length, winRate: round2(winRate), medianWinTime, hitRatio: round2(hitRatio),
      unseenShare: round2(unseen / Math.max(1, taken)),
      wins: wins.length, closeWins: wins.filter((r) => r.hpLeft <= GEARHOLD_CLOSE_HP).length,
      routeTiles, paceRatio: paceRatio === null ? null : round2(paceRatio), scores,
    };
  });

  const avg = (k: keyof LevelScores): number => round2(mean(levels.map((l) => l.scores[k])));
  const balance = { winnable: avg('winnable'), fairDamage: avg('fairDamage'), pace: avg('pace'), feel: avg('feel') };
  // fitness: the balance measures; tension is reported and gated beside it
  const measures = { ...balance, tension: tensionMeasure(levels.map((l) => ({ wins: l.wins, close: l.closeWins }))) };
  return { game: 'gearhold-play', levels, measures, fitness: round2(mean(Object.values(balance))), hardFailures };
}
