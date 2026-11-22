import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 18 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'stones')!;
const bare = (objs: Course['objs']): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.sort((a, b) => a.x - b.x)); return c; };

describe('hyperline STEPPING STONES', () => {
  it('is sector 19 for players, right before HYPERCORE, and introduces the stones pattern', () => {
    expect(sectorInfo(18).name).toBe('STEPPING STONES');
    expect(sectorInfo(19).name).toBe('HYPERCORE');
    expect(INTRO[18]).toBe('stones');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, X0 + 300);
      const first = c.objs.find((o) => o.p === 'stones');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 60);
    }
  });

  it('two pits with a short island between them', () => {
    for (const x of [X0, X0 + 400, X0 + 900]) for (const intro of [true, false]) {
      const { o } = pattern().build(x, 1, () => 0.5, intro);
      const pits = o.filter((q) => q.t === 'pit').sort((a, b) => a.x - b.x);
      expect(pits).toHaveLength(2);
      const island = pits[1]!.x - (pits[0]!.x + pits[0]!.w!);
      expect(island).toBeGreaterThan(1.5);
      expect(island).toBeLessThan(4);
    }
  });

  it('standing still is fatal, and every take-off window is 70 ms or more', () => {
    for (const x of [X0, X0 + 250, X0 + 700]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const c = bare(o);
      const q = createRunner(); q.x = x - 2;
      for (let i = 0; i < 6000 && !q.dead && q.x < x + 30; i++) step(q, c, false);
      expect(q.dead).not.toBe('');
      const r = createRunner(); r.x = x - 2;
      const w = jumpWindow(r, bare(o), 1);
      expect(w).not.toBeNull();
      expect((w!.hi - w!.lo + 1) * STEP * 1000).toBeGreaterThanOrEqual(70);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through STEPPING STONES (to 5200m)', (seed) => {
    expect(clearable(createCourse(seed), 5200)).toBe(true);
  }, 240_000);
});
