// Scores Gearhold gunplay from robot play records (browser runs). Two-sided so a softer, emptier or more generous game never scores higher.
import type { ScoreReport } from './types.js';

export type PlayRecord = {
  level: number; /* 0-based, the game's own index */ seed: number; result: 'win' | 'dead' | 'timeout'; time: number; hpLeft: number;
  kills: number; foes: number; shotsFired: number; hits: number; damageTaken: number; damageUnseen: number; cause: string;
};

export type LevelPlayStats = {
  level: number; n: number; winRate: number;
  medianWinTime: number | null; // seconds, over wins only; null when nothing won
  hitRatio: number;             // median hits / shotsFired over the level's runs
  unseenShare: number;          // damageUnseen / max(1, damageTaken)
};

/** Brian-reviewed bands; changing them changes what "good" means. Win rate: first level (index 0) vs later levels. */
export const GEARHOLD_PLAY_BANDS = {
  firstWin: [0.8, 1.0] as [number, number],
  laterWin: [0.5, 0.9] as [number, number],
  winSeconds: [30, 180] as [number, number],
  hitRatio: [0.35, 0.8] as [number, number],
};

const round2 = (x: number): number => Math.round(x * 100) / 100;
const inBand = (x: number, [lo, hi]: [number, number]): boolean => x >= lo - 1e-9 && x <= hi + 1e-9;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
// Clamped: scatter pellets could make hits exceed shotsFired.
const ratio = (r: PlayRecord): number => (r.shotsFired > 0 ? Math.max(0, Math.min(1, r.hits / r.shotsFired)) : 0);

/** 100 inside [lo, hi], linear down to 0 at 0 and at 1. */
function feelScore(r: number): number {
  const [lo, hi] = GEARHOLD_PLAY_BANDS.hitRatio;
  if (r >= lo && r <= hi) return 100;
  return r < lo ? (100 * Math.max(0, r)) / lo : (100 * Math.max(0, 1 - r)) / (1 - hi);
}

export function scoreGearholdPlay(records: PlayRecord[]): ScoreReport<LevelPlayStats> {
  if (records.length === 0) throw new Error('scoreGearholdPlay: no play records');
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
    return { game: 'gearhold-play', levels: [], measures: { winnable: 0, fairDamage: 0, pace: 0, feel: 0 }, fitness: 0, hardFailures };

  const byLevel = new Map<number, PlayRecord[]>();
  for (const r of records) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
  const levels: LevelPlayStats[] = [...byLevel.keys()].sort((a, b) => a - b).map((level) => {
    const rs = byLevel.get(level)!;
    const wins = rs.filter((r) => r.result === 'win');
    const taken = rs.reduce((s, r) => s + r.damageTaken, 0);
    const unseen = rs.reduce((s, r) => s + r.damageUnseen, 0);
    return {
      level, n: rs.length, winRate: round2(wins.length / rs.length),
      medianWinTime: wins.length ? median(wins.map((r) => r.time)) : null,
      hitRatio: round2(median(rs.map(ratio))),
      unseenShare: round2(unseen / Math.max(1, taken)),
    };
  });

  const pct = (num: number, den: number): number => round2((100 * num) / den);
  const winnable = pct(levels.filter((l) => inBand(l.winRate, l.level === 0 ? B.firstWin : B.laterWin)).length, levels.length);
  const taken = records.reduce((s, r) => s + r.damageTaken, 0);
  const unseen = records.reduce((s, r) => s + r.damageUnseen, 0);
  // fairDamage is one-sided by definition (less unseen damage always raises it); the other measures offset that.
  const fairDamage = round2(Math.max(0, Math.min(100, 100 * (1 - unseen / Math.max(1, taken)))));
  const pace = pct(levels.filter((l) => l.medianWinTime !== null && inBand(l.medianWinTime, B.winSeconds)).length, levels.length);
  const feel = round2(feelScore(median(records.map(ratio))));

  const measures = { winnable, fairDamage, pace, feel };
  const vals = Object.values(measures);
  return {
    game: 'gearhold-play', levels, measures,
    fitness: round2(vals.reduce((a, b) => a + b, 0) / vals.length), hardFailures,
  };
}
