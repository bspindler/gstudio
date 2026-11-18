import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 12 * SECTOR_LEN;

describe('hyperline STAGGER SPIKES', () => {
  it('is sector 13 for players, right before HYPERCORE, and introduces the stagger pattern', () => {
    expect(sectorInfo(11).name).toBe('RISER STEPS');
    expect(sectorInfo(12).name).toBe('STAGGER SPIKES');
    expect(sectorInfo(13).name).toBe('HYPERCORE');
    expect(INTRO[12]).toBe('stagger');
  });

  it('first appears at the start of sector 13, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 3600);
      const first = c.objs.find((o) => o.p === 'stagger');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 40);
    }
  });

  it('is two spike pairs with a short gap inside each pair and a long one between; every take-off window is 50 ms or more', () => {
    const p = PATTERNS.find((q) => q.id === 'stagger')!;
    for (const x of [3010, 3100, 3500, 4200]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = p.build(x, 1, () => rv, intro);
      const sp = o.filter((q) => q.t === 'spike').map((q) => q.x).sort((a, b) => a - b);
      expect(sp).toHaveLength(4);
      const [s0, s1, s2, s3] = sp as [number, number, number, number];
      expect(s1 - s0).toBeLessThan(s2 - s1);
      expect(s3 - s2).toBeLessThan(s2 - s1);
      const c: Course = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...o);
      const r = createRunner(); r.x = x - 6;
      const ms: number[] = [];
      let seen = 0;
      for (let i = 0; i < 4000 && !r.dead && r.x < s3 + 2; i++) {
        step(r, c, false);
        if (r.grounded && seen < 2 && r.x < s3) {
          const w = jumpWindow(r, c, 1);
          if (w) { ms.push((w.hi - w.lo + 1) * STEP * 1000); seen++; break; }
        }
      }
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) expect(m).toBeGreaterThanOrEqual(50);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through STAGGER SPIKES (to 3700m)', (seed) => {
    expect(clearable(createCourse(seed), 3700)).toBe(true);
  }, 240_000);
});
