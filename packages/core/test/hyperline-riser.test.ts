import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, speedAt, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 11 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'riser')!;

/**
 * Taps from every spot before the step; for each tap that lands on the step, records how far along the step the
 * runner landed and the take-off window (ms) it has from there.
 */
function landings(x: number, intro: boolean, rv: number) {
  const { o } = pattern().build(x, 1, () => rv, intro);
  const blk = o.find((q) => q.t === 'block')!, ex = blk.x + blk.w!;
  const c: Course = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...o);
  const out: { land: number; ms: number | null; ok: boolean }[] = [];
  for (let tapX = blk.x - 11; tapX < blk.x - 1; tapX += 0.1) {
    const r = createRunner(); r.x = blk.x - 14;
    let tapped = false, on = false;
    for (let i = 0; i < 4000 && !r.dead && !on; i++) {
      const tap = !tapped && r.x >= tapX;
      if (tap) tapped = true;
      step(r, c, tap);
      if (tapped && r.grounded && r.y === 1) on = true;
    }
    if (!on || r.dead) continue;
    const w = jumpWindow(r, c, 1);
    out.push({ land: r.x - blk.x, ms: w && (w.hi - w.lo + 1) * STEP * 1000, ok: r.x < ex - 0.06 - (intro ? 0.075 : 0.09) * speedAt(r.x) });
  }
  return { out, blk };
}

describe('hyperline RISER STEPS', () => {
  it('is sector 12 for players, right before HYPERCORE, and introduces the riser pattern', () => {
    expect(sectorInfo(10).name).toBe('BOOST PADS');
    expect(sectorInfo(11).name).toBe('RISER STEPS');
    expect(sectorInfo(12).name).toBe('HYPERCORE');
    expect(INTRO[11]).toBe('riser');
  });

  it('first appears at the start of sector 12, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 3500);
      const first = c.objs.find((o) => o.p === 'riser');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 40);
    }
  });

  it('is a short raised step straight into a pit; landing on it is a 50 ms window and so is the take-off', () => {
    for (const x of [2760, 2900, 3300, 4000]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { out, blk } = landings(x, intro, rv);
      const o = pattern().build(x, 1, () => rv, intro).o;
      expect(blk.h).toBe(1);
      expect(blk.w!).toBeLessThanOrEqual(2.8);
      expect(o.some((q) => q.t === 'pit' && Math.abs(q.x - (blk.x + blk.w!)) < 1e-9)).toBe(true);
      const good = out.filter((l) => l.ok);
      // landing window: the taps that land on the step span at least 50 ms
      expect(out.length * 0.1 / speedAt(x)).toBeGreaterThanOrEqual(0.05);
      expect(good.length).toBeGreaterThan(0);
      for (const g of good) { expect(g.ms).not.toBeNull(); expect(g.ms!).toBeGreaterThanOrEqual(50); }
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through RISER STEPS (to 3400m)', (seed) => {
    expect(clearable(createCourse(seed), 3400)).toBe(true);
  }, 240_000);
});
