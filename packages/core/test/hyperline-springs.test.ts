import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 17 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'springs')!;
const bare = (objs: Course['objs']): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.sort((a, b) => a.x - b.x)); return c; };

describe('hyperline SPRING SPIKES', () => {
  it('is sector 18 for players, right before HYPERCORE, and introduces the springs pattern', () => {
    expect(sectorInfo(17).name).toBe('SPRING SPIKES');
    expect(sectorInfo(18).name).toBe('HYPERCORE');
    expect(INTRO[17]).toBe('springs');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, X0 + 300);
      const first = c.objs.find((o) => o.p === 'springs');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 60);
    }
  });

  it('a spring spike is flush with the track until the runner reaches o.f', () => {
    const c = bare([{ t: 'spike', x: 20, y: 0, f: 15 }]);
    const before = createRunner(); before.x = 12;
    for (let i = 0; i < 40; i++) step(before, c, false);
    expect(before.dead).toBe('');
    const q = createRunner(); q.x = 14;
    for (let i = 0; i < 600 && !q.dead; i++) step(q, c, false);
    expect(q.dead).toBe('spike');
  });

  it('no input is fatal, the spikes are up before the window opens, and the take-off window is 110 ms or more', () => {
    for (const x of [X0, X0 + 250, X0 + 700]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const sp = o.filter((q) => q.t === 'spike');
      const c = bare(o);
      const q = createRunner(); q.x = x - 2;
      for (let i = 0; i < 6000 && !q.dead && q.x < sp[0]!.x + 14; i++) step(q, c, false);
      expect(q.dead).toBe('spike');
      const r = createRunner(); r.x = x - 2;
      const w = jumpWindow(r, bare(o), 1);
      expect(w).not.toBeNull();
      expect((w!.hi - w!.lo + 1) * STEP * 1000).toBeGreaterThanOrEqual(110);
      expect(sp[0]!.x - sp[0]!.f!).toBeGreaterThan(5);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through SPRING SPIKES (to 4800m)', (seed) => {
    expect(clearable(createCourse(seed), 4800)).toBe(true);
  }, 240_000);
});
