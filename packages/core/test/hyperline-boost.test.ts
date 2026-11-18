import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

describe('hyperline BOOST PADS', () => {
  it('is sector 11 for players, right before HYPERCORE, and introduces the boost pattern', () => {
    expect(sectorInfo(10).name).toBe('BOOST PADS');
    expect(sectorInfo(11).name).toBe('RISER STEPS');
    expect(INTRO[10]).toBe('boost');
  });

  it('first appears at the start of sector 11, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 3000);
      const first = c.objs.find((o) => o.p === 'boost');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(10 * SECTOR_LEN);
      expect(first!.x).toBeLessThan(10 * SECTOR_LEN + 40);
    }
  });

  it('launches over tall walls onto a landing strip; the tap window stays at 50 ms or more', () => {
    const p = PATTERNS.find((q) => q.id === 'boost')!;
    for (const x of [2510, 2600, 2800, 3300]) for (const intro of [true, false]) {
      const { o } = p.build(x, 1, () => 0.5, intro);
      expect(o.some((q) => q.t === 'block' && q.h === 3)).toBe(true);
      const c: Course = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...o);
      const r = createRunner(); r.x = x - 6;
      let w = null;
      for (let i = 0; i < 4000 && !r.dead && !w; i++) {
        step(r, c, false);
        if (r.x > x + 0.5 + 1.6 && r.grounded) w = jumpWindow(r, c, 1);
      }
      expect(w).not.toBeNull();
      expect((w!.hi - w!.lo + 1) * STEP * 1000).toBeGreaterThanOrEqual(50);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through BOOST PADS (to 2800m)', (seed) => {
    expect(clearable(createCourse(seed), 2800)).toBe(true);
  }, 180_000);
});
