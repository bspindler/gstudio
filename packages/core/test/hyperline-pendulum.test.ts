import { describe, expect, it } from 'vitest';

import { bladeX, createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 16 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'pendulum')!;
const bare = (objs: Course['objs']): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.sort((a, b) => a.x - b.x)); return c; };

describe('hyperline PENDULUM BLADES', () => {
  it('is sector 17 for players, right before HYPERCORE, and introduces the pendulum pattern', () => {
    expect(sectorInfo(16).name).toBe('PENDULUM BLADES');
    expect(sectorInfo(17).name).toBe('HYPERCORE');
    expect(INTRO[16]).toBe('pendulum');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, X0 + 300);
      const first = c.objs.find((o) => o.p === 'pendulum');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 40);
    }
  });

  it('the blade really swings: its left edge moves across its range as the runner advances', () => {
    const { o } = pattern().build(X0, 1, () => 0.5, true);
    const b = o.find((q) => q.t === 'blade')!;
    const xs = Array.from({ length: 400 }, (_, i) => bladeX(b, X0 + i * 0.1));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(b.amp! * 1.9);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(b.x - 1e-9);
  });

  it('no input is fatal, and the take-off window is 110 ms or more, at every phase and size', () => {
    for (const x of [X0, X0 + 250, X0 + 700]) for (const intro of [true, false]) for (const rv of [0, 0.25, 0.5, 0.75, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const blade = o.find((q) => q.t === 'blade')!;
      const q = createRunner(); q.x = x - 2;
      const c = bare(o);
      for (let i = 0; i < 6000 && !q.dead && q.x < blade.x + 14; i++) step(q, c, false);
      expect(q.dead).toBe('blade');
      const r = createRunner(); r.x = x - 12; // far enough back that the window is not cut off by the start
      const w =jumpWindow(r, bare(o), 3);
      expect(w).not.toBeNull();
      expect((w!.hi - w!.lo + 1) * STEP * 1000).toBeGreaterThanOrEqual(110);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through PENDULUM BLADES (to 4400m)', (seed) => {
    expect(clearable(createCourse(seed), 4400)).toBe(true);
  }, 240_000);
});
