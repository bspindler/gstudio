import { describe, expect, it } from 'vitest';

import { GEARHOLD_PLAY_BANDS, scoreGearholdPlay, type PlayRecord } from '../src/hal/gearhold-play-score.js';

const rec = (over: Partial<PlayRecord> = {}): PlayRecord => ({
  level: 1, seed: 0, result: 'win', time: 60, hpLeft: 50, kills: 5, foes: 5,
  shotsFired: 100, hits: 50, damageTaken: 50, damageUnseen: 0, cause: '', ...over,
});
/** n records for a level, `wins` of them wins. */
const block = (level: number, n: number, wins: number, over: Partial<PlayRecord> = {}): PlayRecord[] =>
  Array.from({ length: n }, (_, i) => rec({
    level, seed: i, result: i < wins ? 'win' : 'dead', ...over,
  }));
const good = (): PlayRecord[] => [...block(1, 10, 9), ...block(2, 10, 7), ...block(3, 10, 6)];

describe('scoreGearholdPlay', () => {
  it('pins the bands', () => {
    expect(GEARHOLD_PLAY_BANDS).toMatchObject({
      firstWin: [0.8, 1], laterWin: [0.5, 0.9], winSeconds: [30, 180], hitRatio: [0.35, 0.8],
    });
  });

  it('scores a healthy run at 100', () => {
    const r = scoreGearholdPlay(good());
    expect(r.game).toBe('gearhold-play');
    expect(r.measures).toEqual({ winnable: 100, fairDamage: 100, pace: 100, feel: 100 });
    expect(r.fitness).toBe(100);
    expect(r.hardFailures).toEqual([]);
    expect(r.levels.map((l) => [l.level, l.n, l.winRate])).toEqual([[1, 10, 0.9], [2, 10, 0.7], [3, 10, 0.6]]);
    expect(r.levels[0]!.medianWinTime).toBe(60);
    expect(r.levels[0]!.hitRatio).toBe(0.5);
  });

  it('winnable is two-sided: too easy and too hard both lose', () => {
    const easyLater = scoreGearholdPlay([...block(1, 10, 9), ...block(2, 10, 10), ...block(3, 10, 10)]);
    expect(easyLater.measures.winnable).toBeCloseTo(33.33, 1);
    const hard = scoreGearholdPlay([...block(1, 10, 5), ...block(2, 10, 7), ...block(3, 10, 6)]);
    expect(hard.measures.winnable).toBeCloseTo(66.67, 1);
    const l1Perfect = scoreGearholdPlay([...block(1, 10, 10), ...block(2, 10, 7), ...block(3, 10, 6)]);
    expect(l1Perfect.measures.winnable).toBe(100); // 1.0 is in level 1's band
  });

  it('fairDamage drops with unseen damage and never exceeds 100', () => {
    const r = scoreGearholdPlay(block(1, 4, 4, { damageTaken: 100, damageUnseen: 25 }));
    expect(r.measures.fairDamage).toBe(75);
    expect(scoreGearholdPlay(block(1, 4, 4, { damageTaken: 0, damageUnseen: 0 })).measures.fairDamage).toBe(100);
  });

  it('pace is two-sided: too fast and too slow fail, no wins fails', () => {
    const fast = scoreGearholdPlay(block(1, 10, 9, { time: 10 }));
    const slow = scoreGearholdPlay(block(1, 10, 9, { time: 200 }));
    const none = scoreGearholdPlay(block(1, 10, 0, { time: 60 }));
    expect(fast.measures.pace).toBe(0);
    expect(slow.measures.pace).toBe(0);
    expect(none.measures.pace).toBe(0);
    expect(none.levels[0]!.medianWinTime).toBeNull();
  });

  it('median win time ignores losses', () => {
    const recs = [...block(1, 9, 9, { time: 60 }), rec({ result: 'dead', time: 5, seed: 99 })];
    expect(scoreGearholdPlay(recs).levels[0]!.medianWinTime).toBe(60);
  });

  it('feel is two-sided on hit ratio', () => {
    const f = (hits: number) => scoreGearholdPlay(block(1, 5, 4, { shotsFired: 100, hits })).measures.feel;
    expect(f(35)).toBe(100);
    expect(f(80)).toBe(100);
    expect(f(0)).toBe(0);
    expect(f(100)).toBe(0);
    expect(f(90)).toBe(50); // between 0.8 and 1
    expect(f(17.5)).toBe(50); // between 0 and 0.35
  });

  it('a hit ratio near 1 (oversized hitboxes) scores low', () => {
    expect(scoreGearholdPlay(block(1, 5, 4, { shotsFired: 100, hits: 98 })).measures.feel).toBeLessThan(15);
  });

  it('timeouts are losses and fail pace when nothing wins', () => {
    const r = scoreGearholdPlay(block(1, 10, 0).map((x) => ({ ...x, result: 'timeout' as const, time: 240 })));
    expect(r.levels[0]!.winRate).toBe(0);
    expect(r.measures.pace).toBe(0);
    expect(r.measures.winnable).toBe(0);
  });

  it('timeouts count against win rate', () => {
    const recs = [...block(1, 8, 8), ...block(1, 2, 0).map((x, i) => ({ ...x, seed: 50 + i, result: 'timeout' as const }))];
    expect(scoreGearholdPlay(recs).levels[0]!.winRate).toBe(0.8);
  });

  it('flags NaN records as hard failures', () => {
    const r = scoreGearholdPlay([rec({ time: NaN })]);
    expect(r.hardFailures.length).toBeGreaterThan(0);
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
