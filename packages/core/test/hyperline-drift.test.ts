import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { blockX, createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { takeoffTicks } from '../../../games/hyperline/render.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 20 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'drift')!;
const bare = (objs: Course['objs']): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.sort((a, b) => a.x - b.x)); return c; };

describe('hyperline DRIFT BLOCKS', () => {
  it('is sector 21 for players, after SLIDING LEDGE and before the beat sectors, and introduces the drift pattern', () => {
    expect(sectorInfo(19).name).toBe('SLIDING LEDGE');
    expect(sectorInfo(20).name).toBe('DRIFT BLOCKS');
    expect(sectorInfo(21).name).toBe('ON THE BEAT');
    expect(sectorInfo(23).name).toBe('HYPERCORE');
    expect(INTRO[20]).toBe('drift');
  });

  it('first appears at the start of its sector, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, X0 + 300);
      const first = c.objs.find((o) => o.p === 'drift');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 60);
    }
  });

  it('the block drifts: it is further along the track the earlier you look, and stops at m', () => {
    const { o } = pattern().build(X0, 1, () => 0.5, true);
    const b = o.find((q) => q.t === 'block')!;
    expect(b.sl).toBeGreaterThan(0);
    expect(b.sl!).toBeLessThan(0.6); // gentler than the shuttle
    expect(blockX(b, b.m! - 10)).toBeGreaterThan(blockX(b, b.m!));
    expect(blockX(b, b.m! + 5)).toBe(blockX(b, b.m!));
  });

  it('standing still is fatal, and every take-off window is 50 ms or more', () => {
    for (const x of [X0, X0 + 250, X0 + 700]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      expect(Math.min(...o.map((q) => q.x))).toBeGreaterThanOrEqual(x);
      const q = createRunner(); q.x = x - 2;
      const c = bare(o);
      for (let i = 0; i < 6000 && !q.dead && q.x < x + 40; i++) step(q, c, false);
      expect(q.dead).not.toBe('');
      const r = createRunner(); r.x = x - 20;
      let ms = 0;
      const c2 = bare(o);
      for (let i = 0; i < 4000 && !r.dead; i++) {
        step(r, c2, false);
        if (r.grounded) { const w = jumpWindow(r, c2, 1.2); if (w) { ms = (w.hi - w.lo + 1) * STEP * 1000; break; } }
      }
      expect(ms).toBeGreaterThanOrEqual(50);
      expect(ms).toBeLessThan(200);
    }
  });

  it('the take-off tick follows the block as it drifts', () => {
    const { o } = pattern().build(X0, 1, () => 0.5, true);
    const b = o.find((q) => q.t === 'block')!;
    const [moving] = takeoffTicks([b], b.x - 15);
    const [fixed] = takeoffTicks([{ t: 'block', x: b.x, w: b.w!, h: 1 }], b.x - 15);
    expect(moving).toBeDefined();
    expect(fixed).toBeDefined();
    expect(moving!.x).toBeGreaterThan(fixed!.x);
  });

  it.each([7, 42, 1337])('seed %i is clearable through DRIFT BLOCKS (to 5600m)', (seed) => {
    expect(clearable(createCourse(seed), 5600)).toBe(true);
  }, 240_000);
});
