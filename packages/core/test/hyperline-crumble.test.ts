import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS } from '../../../games/hyperline/lib/course.js';
import { AIR, SECTOR_LEN, sectorInfo, speedAt } from '../../../games/hyperline/lib/world.js';
import { clearable } from '../src/hal/hyperline-bot.js';

describe('hyperline CRUMBLE TRACK', () => {
  it('is sector 10 for players, between PULSE RAILS and HYPERCORE, and introduces the crumble panels', () => {
    expect(sectorInfo(8).name).toBe('PULSE RAILS');
    expect(sectorInfo(9).name).toBe('CRUMBLE TRACK');
    expect(sectorInfo(10).name).toBe('HYPERCORE');
    expect(INTRO[9]).toBe('crumble');
  });

  it('first appears at the start of sector 10, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 2800);
      const first = c.objs.find((o) => o.c);
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(9 * SECTOR_LEN);
      expect(first!.x).toBeLessThan(9 * SECTOR_LEN + 40);
    }
  });

  it('holes are within jump range, warn before they drop, and leave solid track between', () => {
    const p = PATTERNS.find((q) => q.id === 'crumble')!;
    for (const x of [2250, 2400, 2700]) {
      const { o, len } = p.build(x, 1, () => 0.5);
      const holes = o.filter((q) => q.t === 'pit');
      expect(holes.length).toBeGreaterThanOrEqual(2);
      for (const h of holes) {
        expect(h.c).toBe(1);
        expect(h.w!).toBeLessThanOrEqual(speedAt(h.x) * AIR * 0.72);
        expect(h.glow!).toBeGreaterThan(h.drop!);
        expect(h.drop!).toBeGreaterThan(speedAt(h.x) * 0.5);
        expect(h.x + h.w!).toBeLessThanOrEqual(x + len);
      }
      for (let i = 1; i < holes.length; i++) expect(holes[i]!.x - (holes[i - 1]!.x + holes[i - 1]!.w!)).toBeGreaterThan(speedAt(x) * AIR * 0.6);
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through CRUMBLE TRACK (to 2550m)', (seed) => {
    expect(clearable(createCourse(seed), 2550)).toBe(true);
  }, 180_000);
});
