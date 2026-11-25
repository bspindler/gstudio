import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, pitEnd, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 19 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'ledge')!;
const bare = (objs: Course['objs']): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.sort((a, b) => a.x - b.x)); return c; };

describe('hyperline SLIDING LEDGE', () => {
  it('is sector 20 for players, right before HYPERCORE, and introduces the ledge pattern', () => {
    expect(sectorInfo(19).name).toBe('SLIDING LEDGE');
    expect(sectorInfo(20).name).toBe('DRIFT BLOCKS');
    expect(INTRO[19]).toBe('ledge');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, X0 + 300);
      const first = c.objs.find((o) => o.p === 'ledge');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 60);
    }
  });

  it('the far edge slides, and slowly: it never gains on the runner', () => {
    const { o } = pattern().build(X0, 1, () => 0.3, true);
    const pit = o.find((q) => q.t === 'pit')!;
    const ends = Array.from({ length: 400 }, (_, i) => pitEnd(pit, pit.x - 5 + i * 0.1));
    expect(Math.max(...ends) - Math.min(...ends)).toBeGreaterThan(0.7);
    for (let i = 1; i < ends.length; i++) expect(Math.abs(ends[i]! - ends[i - 1]!)).toBeLessThan(0.1 * 0.5);
  });

  it('standing still is fatal, and every take-off window is 60 ms or more', () => {
    for (const x of [X0, X0 + 250, X0 + 700]) for (const intro of [true, false]) for (let k = 0; k < 12; k++) {
      const { o } = pattern().build(x, 1, () => k / 12, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const q = createRunner(); q.x = x - 2;
      const c = bare(o);
      for (let i = 0; i < 6000 && !q.dead && q.x < x + 30; i++) step(q, c, false);
      expect(q.dead).not.toBe('');
      const r = createRunner(); r.x = x - 2;
      const w = jumpWindow(r, bare(o), 1);
      expect(w).not.toBeNull();
      expect((w!.hi - w!.lo + 1) * STEP * 1000).toBeGreaterThanOrEqual(60);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through SLIDING LEDGE (to 5700m)', (seed) => {
    expect(clearable(createCourse(seed), 5700)).toBe(true);
  }, 240_000);
});
