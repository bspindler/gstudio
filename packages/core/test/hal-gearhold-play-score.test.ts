import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/gearhold/levels.js';
import { GEARHOLD_PLAY_BANDS, scoreGearholdPlay as scoreWith, type PlayRecord } from '../src/hal/gearhold-play-score.js';

/** A sealed hall whose walker route is `k` tiles (S at x=1, the exit at x=k+2). */
const hall = (k: number): string[] => [
  '#'.repeat(k + 3), `#S${'.'.repeat(k)}X`, `#${'.'.repeat(k + 1)}#`, `#${'.'.repeat(k + 1)}#`, '#'.repeat(k + 3),
];
/** 72 tiles at 3.6 tiles/s: a 20 s walk, so the default 60 s win is a pace ratio of 3 (in band). */
const MAPS = [hall(72), hall(72), hall(72)];
const scoreGearholdPlay = (records: PlayRecord[], maps: string[][] = MAPS) => scoreWith(records, { maps });

const rec = (over: Partial<PlayRecord> = {}): PlayRecord => ({
  level: 0, seed: 0, result: 'win', time: 60, hpLeft: 50, kills: 5, foes: 5,
  shotsFired: 100, hits: 50, damageTaken: 50, damageUnseen: 0, cause: '', ...over,
});
/** n records for a level, `wins` of them wins. */
const block = (level: number, n: number, wins: number, over: Partial<PlayRecord> = {}): PlayRecord[] =>
  Array.from({ length: n }, (_, i) => rec({
    level, seed: i, result: i < wins ? 'win' : 'dead', ...over,
  }));
const good = (): PlayRecord[] => [...block(0, 10, 9), ...block(1, 10, 7), ...block(2, 10, 6)];

describe('scoreGearholdPlay', () => {
  it('pins the bands', () => {
    expect(GEARHOLD_PLAY_BANDS).toMatchObject({
      firstWin: [0.8, 1], laterWin: [0.5, 0.9], hitRatio: [0.35, 0.8],
      paceRatio: [1.5, 4], paceRatioZero: 8, maxWinSeconds: 180,
    });
  });

  it('scores a healthy run at 100', () => {
    const r = scoreGearholdPlay(good());
    expect(r.game).toBe('gearhold-play');
    expect(r.measures).toMatchObject({ winnable: 100, fairDamage: 100, pace: 100, feel: 100 });
    expect(Object.keys(r.measures)).toEqual(['winnable', 'fairDamage', 'pace', 'feel', 'tension']);
    expect(r.fitness).toBe(100); // the balance measures only: tension is reported and gated beside fitness
    expect(r.hardFailures).toEqual([]);
    expect(r.levels.map((l) => [l.level, l.n, l.winRate])).toEqual([[0, 10, 0.9], [1, 10, 0.7], [2, 10, 0.6]]);
    expect(r.levels[0]!.medianWinTime).toBe(60);
    expect(r.levels[0]!.hitRatio).toBe(0.5);
    expect(r.levels[0]!.routeTiles).toBe(72);
    expect(r.levels[0]!.paceRatio).toBe(3);
  });

  it('every level carries its own 0-100 scores, and the measures are their means', () => {
    const r = scoreGearholdPlay([...block(0, 10, 9), ...block(1, 20, 19), ...block(2, 10, 6, { hits: 90 })]);
    expect(r.levels.map((l) => l.scores)).toEqual([
      { winnable: 100, fairDamage: 100, pace: 100, feel: 100 },
      { winnable: 50, fairDamage: 100, pace: 100, feel: 100 },
      { winnable: 100, fairDamage: 100, pace: 100, feel: 50 },
    ]);
    expect(r.measures.winnable).toBe(83.33);
    expect(r.measures.feel).toBe(83.33);
    expect(r.fitness).toBe(91.67);
  });

  it('winnable is per level and smooth: a near miss costs a little, not a 33-point step', () => {
    const nearMiss = scoreGearholdPlay([...block(0, 10, 9), ...block(1, 50, 46), ...block(2, 10, 6)]); // 0.92 vs 0.9
    expect(nearMiss.levels[1]!.scores.winnable).toBe(80);
    expect(nearMiss.measures.winnable).toBe(93.33);
    const easyLater = scoreGearholdPlay([...block(0, 10, 9), ...block(1, 10, 10), ...block(2, 10, 10)]);
    expect(easyLater.measures.winnable).toBeCloseTo(33.33, 1); // 1.0 is the far end of the later band
    const hard = scoreGearholdPlay([...block(0, 10, 5), ...block(1, 10, 7), ...block(2, 10, 6)]);
    expect(hard.levels[0]!.scores.winnable).toBe(62.5); // 0.5 against [0.8, 1]
    const l1Perfect = scoreGearholdPlay([...block(0, 10, 10), ...block(1, 10, 7), ...block(2, 10, 6)]);
    expect(l1Perfect.measures.winnable).toBe(100); // 1.0 is in level 1's band
  });

  it('fairDamage is per level and drops with unseen damage', () => {
    const r = scoreGearholdPlay(block(0, 4, 4, { damageTaken: 100, damageUnseen: 25 }));
    expect(r.measures.fairDamage).toBe(75);
    expect(scoreGearholdPlay(block(0, 4, 4, { damageTaken: 0, damageUnseen: 0 })).measures.fairDamage).toBe(100);
    const two = scoreGearholdPlay([...block(0, 4, 4, { damageTaken: 100, damageUnseen: 50 }), ...block(1, 4, 3)]);
    expect(two.measures.fairDamage).toBe(75); // (50 + 100) / 2
  });

  it('pace is win time over the walker route time, two-sided; no wins fails', () => {
    const p = (time: number, wins = 9) => scoreGearholdPlay(block(0, 10, wins, { time })).measures.pace;
    expect(p(30)).toBe(100); // ratio 1.5
    expect(p(80)).toBe(100); // ratio 4
    expect(p(20)).toBe(66.67); // ratio 1: a straight walk, nothing in the way
    expect(p(120)).toBe(50); // ratio 6: bogged down
    expect(p(160)).toBe(0); // ratio 8
    expect(p(60, 0)).toBe(0);
    expect(scoreGearholdPlay(block(0, 10, 0)).levels[0]!.medianWinTime).toBeNull();
  });

  it('pace caps a long level: a win over 180 s loses points even with a healthy ratio', () => {
    const big = [hall(360)]; // a 100 s walk
    expect(scoreGearholdPlay(block(0, 10, 9, { time: 170 }), big).measures.pace).toBe(100);
    expect(scoreGearholdPlay(block(0, 10, 9, { time: 270 }), big).measures.pace).toBe(50);
  });

  it('median win time ignores losses', () => {
    const recs = [...block(0, 9, 9, { time: 60 }), rec({ result: 'dead', time: 5, seed: 99 })];
    expect(scoreGearholdPlay(recs).levels[0]!.medianWinTime).toBe(60);
  });

  it('feel is two-sided on hit ratio', () => {
    const f = (hits: number) => scoreGearholdPlay(block(0, 5, 4, { shotsFired: 100, hits })).measures.feel;
    expect(f(35)).toBe(100);
    expect(f(80)).toBe(100);
    expect(f(0)).toBe(0);
    expect(f(100)).toBe(0);
    expect(f(90)).toBe(50); // between 0.8 and 1
    expect(f(17.5)).toBe(50); // between 0 and 0.35
  });

  it('feel is per level, not one pooled median', () => {
    // Pooled, the median hit ratio of these runs is in band; per level, one level's gun is clearly off.
    const r = scoreGearholdPlay([...block(0, 10, 9, { hits: 50 }), ...block(1, 10, 7, { hits: 50 }), ...block(2, 10, 6, { hits: 10 })]);
    expect(r.levels.map((l) => l.scores.feel)).toEqual([100, 100, 28.57]);
    expect(r.measures.feel).toBe(76.19);
  });

  it('a hit ratio near 1 (oversized hitboxes) scores low', () => {
    expect(scoreGearholdPlay(block(0, 5, 4, { shotsFired: 100, hits: 98 })).measures.feel).toBeLessThan(15);
  });

  it('timeouts are losses and fail pace when nothing wins', () => {
    const r = scoreGearholdPlay(block(0, 10, 0).map((x) => ({ ...x, result: 'timeout' as const, time: 240 })));
    expect(r.levels[0]!.winRate).toBe(0);
    expect(r.measures.pace).toBe(0);
    expect(r.measures.winnable).toBe(0);
  });

  it('timeouts count against win rate', () => {
    const recs = [...block(0, 8, 8), ...block(0, 2, 0).map((x, i) => ({ ...x, seed: 50 + i, result: 'timeout' as const }))];
    expect(scoreGearholdPlay(recs).levels[0]!.winRate).toBe(0.8);
  });

  it('flags NaN or invalid-result records as hard failures and excludes them', () => {
    const r = scoreGearholdPlay([...block(0, 10, 9), rec({ seed: 99, hits: NaN }), rec({ seed: 98, result: 'bogus' as never })]);
    expect(r.hardFailures.length).toBe(2);
    expect(r.levels[0]!.n).toBe(10);
    expect(r.measures.feel).toBe(100);
    expect(scoreGearholdPlay([rec({ time: NaN })]).fitness).toBe(0);
  });

  it("the map walker's structural problems are hard failures (the static scorer left fitness, its checks did not)", () => {
    const noExit = hall(72).map((row) => row.replace('X', '#'));
    const r = scoreGearholdPlay(good(), [hall(72), noExit, hall(72)]);
    expect(r.hardFailures).toEqual(['level 2: no exit']);
    expect(r.levels[1]!.scores.pace).toBe(0); // no route to time against
  });

  it('a level with no map is a hard failure', () => {
    expect(scoreGearholdPlay(good(), [hall(72), hall(72)]).hardFailures).toContain('level 3: no map');
  });

  it("uses the game's own maps by default", () => {
    const r = scoreWith(block(0, 10, 9));
    expect(r.hardFailures).toEqual([]);
    expect(r.levels[0]!.routeTiles).toBe(28);
    expect(LEVELS.length).toBeGreaterThan(0);
  });

  it('clamps the hit ratio to 1 (scatter pellets)', () => {
    expect(scoreGearholdPlay(block(0, 5, 4, { shotsFired: 10, hits: 30 })).levels[0]!.hitRatio).toBe(1);
  });

  it('uses 0-based levels: level 0 gets the first-level band', () => {
    const r = scoreGearholdPlay([...block(0, 10, 10), ...block(1, 10, 3)]);
    expect(r.levels.map((l) => l.scores.winnable)).toEqual([100, 60]); // level 1 at 0.3 against [0.5, 0.9]
    expect(r.measures.winnable).toBe(80);
  });

  it('feel handles mixed zero-shot records via the median', () => {
    const recs = [...block(0, 3, 3, { shotsFired: 0, hits: 0 }), ...block(0, 4, 3, { shotsFired: 100, hits: 50 })];
    expect(scoreGearholdPlay(recs).measures.feel).toBe(100);
  });

  it('reports seed noise per measure and per level', () => {
    const recs = [...block(0, 20, 18), ...block(1, 20, 14), ...block(2, 20, 12)].map((r, i) => ({ ...r, hits: 20 + (i * 7) % 60 }));
    const r = scoreGearholdPlay(recs);
    expect(Object.keys(r.noise!).sort()).toEqual(['fairDamage', 'feel', 'fitness', 'pace', 'tension', 'winnable']);
    expect(r.levels[1]!.noise).toBeDefined();
    expect(Object.keys(r.levels[1]!.noise!).sort()).toEqual(['fairDamage', 'feel', 'pace', 'winnable']);
    expect(r.levels[1]!.noise!.winnable).toBeGreaterThanOrEqual(0);
  });

  it('throws on empty input', () => {
    expect(() => scoreGearholdPlay([])).toThrow();
  });

  it('is deterministic and does not mutate its input', () => {
    const recs = good();
    const copy = structuredClone(recs);
    expect(scoreGearholdPlay(recs)).toEqual(scoreGearholdPlay(copy));
    expect(recs).toEqual(copy);
  });
});
