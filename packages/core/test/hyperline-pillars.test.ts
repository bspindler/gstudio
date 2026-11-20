import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 15 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'pillars')!;
const bare = (objs: Course['objs']): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.sort((a, b) => a.x - b.x)); return c; };

describe('hyperline FALLING PILLARS', () => {
  it('is sector 16 for players, right before PENDULUM BLADES, and introduces the pillars pattern', () => {
    expect(sectorInfo(15).name).toBe('FALLING PILLARS');
    expect(sectorInfo(16).name).toBe('PENDULUM BLADES');
    expect(INTRO[15]).toBe('pillars');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 4300);
      const first = c.objs.find((o) => o.p === 'pillars');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 40);
    }
  });

  it('a pillar is not on the track until the runner reaches its landing point', () => {
    const c = bare([{ t: 'block', x: 20, w: 1, h: 1, f: 15 }]);
    const before = createRunner();
    before.x = 12;
    for (let i = 0; i < 40; i++) step(before, c, false); // x is about 12-14: nothing there yet
    expect(before.dead).toBe('');
    const q = createRunner(); q.x = 14;
    for (let i = 0; i < 600 && !q.dead; i++) step(q, c, false);
    expect(q.dead).toBe('block');
  });

  it('no input is fatal, and the take-off window is 100 ms or more, at every size', () => {
    for (const x of [3750, 3900, 4300, 5000]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const blk = o.find((q) => q.t === 'block')!;
      expect(blk.f).toBeLessThan(blk.x);
      const c = bare(o);
      const q = createRunner(); q.x = x - 2;
      for (let i = 0; i < 6000 && !q.dead && q.x < blk.x + 12; i++) step(q, c, false);
      expect(q.dead).not.toBe('');
      // the first window the casual player sees, once the pillar is down
      const r = createRunner(); r.x = blk.f! + 0.5;
      const w = jumpWindow(r, bare(o), 1);
      expect(w).not.toBeNull();
      expect((w!.hi - w!.lo + 1) * STEP * 1000).toBeGreaterThanOrEqual(100);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through FALLING PILLARS (to 4400m)', (seed) => {
    expect(clearable(createCourse(seed), 4400)).toBe(true);
  }, 240_000);
});
