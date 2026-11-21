import { describe, expect, it } from 'vitest';
import { TICK, takeoffTicks, tickAlpha } from '../../../games/hyperline/render.js';
import { AIR, speedAt } from '../../../games/hyperline/lib/world.js';

describe('hyperline take-off ticks', () => {
  it('fades in from far, is faint, and is gone once passed', () => {
    expect(tickAlpha(0)).toBe(0);
    expect(tickAlpha(-3)).toBe(0);
    expect(tickAlpha(TICK.reach + 1)).toBe(0);
    expect(tickAlpha(15)).toBeGreaterThan(0);
    for (const a of [1, 5, 15, 25]) expect(tickAlpha(a)).toBeLessThanOrEqual(TICK.max);
    expect(TICK.max).toBeLessThanOrEqual(0.5);
    expect(tickAlpha(1)).toBeLessThan(tickAlpha(10));
  });
  it('marks the point where a jump peaks over the obstacle middle', () => {
    const o = { t: 'block', x: 60, w: 2, h: 1 };
    const [k] = takeoffTicks([o], 40);
    const mid = 61;
    if (!k) throw new Error('no tick');
    expect(k.x).toBeCloseTo(mid - (AIR * speedAt(mid)) / 2, 6);
    expect(k.a).toBeGreaterThan(0);
  });
  it('skips passed, far and non-jump obstacles, and does not touch the course', () => {
    const objs = [{ t: 'block', x: 10, w: 2, h: 1 }, { t: 'bar', x: 50, w: 2, y: 1 }, { t: 'block', x: 400, w: 2, h: 1 }];
    const before = JSON.stringify(objs);
    expect(takeoffTicks(objs, 30)).toEqual([]);
    expect(JSON.stringify(objs)).toBe(before);
  });
});
