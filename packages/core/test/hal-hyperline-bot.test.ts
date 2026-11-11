import { describe, expect, it } from 'vitest';

import { createCourse } from '../../../games/hyperline/lib/course.js';
import { sectorAt } from '../../../games/hyperline/lib/world.js';
import { casualRun, clearable, HYPERLINE_CASUAL, SEARCH_BUDGET } from '../src/hal/hyperline-bot.js';

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('clearable', () => {
  it('has a 2M state budget', () => {
    expect(SEARCH_BUDGET).toBe(2_000_000);
  });

  it("returns 'unknown' when the budget runs out", () => {
    expect(clearable(createCourse(7), 1900, 50)).toBe('unknown');
  });

  it('a generous budget still clears a short course', () => {
    expect(clearable(createCourse(7), 100)).toBe(true);
  });
});

describe('casualRun', () => {
  it('plans 1 s ahead and slips 5% of decisions', () => {
    expect(HYPERLINE_CASUAL).toEqual({ slip: 0.05, horizon: 1 });
    expect(HYPERLINE_CASUAL.slip).toBeGreaterThan(0);
    expect(HYPERLINE_CASUAL.slip).toBeLessThan(1);
  });

  it('is deterministic per seed', () => {
    expect(casualRun(3, 1900)).toEqual(casualRun(3, 1900));
  });

  it('dies in more than one sector across seeds, never past until, and survivors have no cause', () => {
    const runs = seeds(20).map((s) => casualRun(s, 1900));
    expect(new Set(runs.map((r) => r.sector)).size).toBeGreaterThan(1);
    for (const r of runs) {
      expect(r.dist).toBeLessThanOrEqual(1900);
      expect(r.dist).toBeGreaterThan(0);
      if (r.dist >= 1900) expect(r.cause).toBe('');
      else {
        expect(r.cause).not.toBe('');
        expect(r.sector).toBe(sectorAt(r.dist));
      }
    }
  });

  it('over seeds 1..40 the median death sector is 2..6 and at least 10% reach sector 5', () => {
    const sectors = seeds(40).map((s) => casualRun(s, 1900).sector).sort((a, b) => a - b);
    const median = (sectors[19]! + sectors[20]!) / 2;
    expect(median).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThanOrEqual(6);
    expect(sectors.filter((s) => s >= 5).length).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it('a short target is reached with no cause', () => {
    const r = casualRun(1, 20);
    expect(r).toMatchObject({ dist: 20, cause: '' });
    expect(r.jumps).toBeGreaterThanOrEqual(0);
  });
});
