import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course, type Obj } from '../../../games/hyperline/lib/course.js';
import { createRunner, railLit, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, speedAt } from '../../../games/hyperline/lib/world.js';
import { clearable } from '../src/hal/hyperline-bot.js';

const bare = (objs: Obj[]): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs); return c; };

describe('hyperline PULSE RAILS', () => {
  it('is sector 9 for players, right before HYPERCORE, and introduces the pulse rail', () => {
    expect(sectorInfo(7).name).toBe('SWEEP COLUMNS');
    expect(sectorInfo(8).name).toBe('PULSE RAILS');
    expect(sectorInfo(9).name).toBe('HYPERCORE');
    expect(INTRO[8]).toBe('pulse');
  });

  it('first appears at the start of sector 9, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 2400);
      const first = c.objs.find((o) => o.t === 'rail');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(8 * SECTOR_LEN);
      expect(first!.x).toBeLessThan(8 * SECTOR_LEN + 40);
    }
  });

  it('the rail beats: lit, dark, lit', () => {
    const o: Obj = { t: 'rail', x: 10, w: 9, per: 6 };
    expect(railLit(o, 11)).toBe(true);
    expect(railLit(o, 14)).toBe(false);
    expect(railLit(o, 17)).toBe(true);
  });

  it('running along a lit rail crashes; a dark one is safe', () => {
    const run = (o: Obj) => { const c = bare([o]); const r = createRunner(); while (!r.dead && r.x < 40) step(r, c, false); return r.dead; };
    expect(run({ t: 'rail', x: 12, w: 4, per: 8 })).toBe('rail');
    expect(run({ t: 'rail', x: 12, w: 3, per: 8, ph: 0.5 })).toBe('');
  });

  it('the pattern keeps its rail on solid track and inside its own length', () => {
    const p = PATTERNS.find((q) => q.id === 'pulse')!;
    for (const x of [2000, 2200, 2600]) {
      const { o, len } = p.build(x, 1, () => 0.5);
      const rail = o.find((q) => q.t === 'rail')!;
      expect(rail.per!).toBeGreaterThan(speedAt(x) * 0.5);
      expect(rail.x + rail.w!).toBeLessThanOrEqual(x + len);
      expect(o.some((q) => q.t === 'pit')).toBe(false);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through PULSE RAILS (to 2550m)', (seed) => {
    expect(clearable(createCourse(seed), 2550)).toBe(true);
  }, 180_000);
});
