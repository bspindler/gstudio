import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { blockX, createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo } from '../../../games/hyperline/lib/world.js';
import { clearable } from '../src/hal/hyperline-bot.js';

const X0 = 14 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'shuttle')!;

describe('hyperline SHUTTLE BLOCKS', () => {
  it('is sector 15 for players, right before FALLING PILLARS, and introduces the shuttle pattern', () => {
    expect(sectorInfo(13).name).toBe('DROP LEDGES');
    expect(sectorInfo(14).name).toBe('SHUTTLE BLOCKS');
    expect(sectorInfo(15).name).toBe('FALLING PILLARS');
    expect(INTRO[14]).toBe('shuttle');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 3900);
      const first = c.objs.find((o) => o.p === 'shuttle');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 40);
    }
  });

  it('the block slides toward the runner and rests at its own x', () => {
    const { o } = pattern().build(3600, 1, () => 0.5, true);
    const b = o.find((q) => q.t === 'block')!;
    expect(blockX(b, b.m! - 20)).toBeGreaterThan(blockX(b, b.m! - 10));
    expect(blockX(b, b.m! + 5)).toBe(b.x);
  });

  it('every object starts at or after the pattern start, and no input is fatal', () => {
    for (const x of [3500, 3600, 4000, 4600]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const blk = o.find((q) => q.t === 'block')!;
      const c: Course = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...o.sort((a, b) => a.x - b.x));
      const q = createRunner(); q.x = x - 2;
      for (let i = 0; i < 4000 && !q.dead && q.x < blk.m! + 10; i++) step(q, c, false);
      expect(q.dead).not.toBe('');
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through SHUTTLE BLOCKS (to 4100m)', (seed) => {
    expect(clearable(createCourse(seed), 4100)).toBe(true);
  }, 240_000);
});
