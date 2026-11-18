import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorInfo, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable, jumpWindow } from '../src/hal/hyperline-bot.js';

const X0 = 13 * SECTOR_LEN;
const pattern = () => PATTERNS.find((q) => q.id === 'drop')!;

describe('hyperline DROP LEDGES', () => {
  it('is sector 14 for players, after STAGGER SPIKES, and introduces the drop pattern', () => {
    expect(sectorInfo(12).name).toBe('STAGGER SPIKES');
    expect(sectorInfo(13).name).toBe('DROP LEDGES');
    expect(INTRO[13]).toBe('drop');
  });

  it('first appears at the start of sector 14, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 3700);
      const first = c.objs.find((o) => o.p === 'drop');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(X0);
      expect(first!.x).toBeLessThan(X0 + 40);
    }
  });

  it('is a ledge with a spike strip at its foot; running off it dies and the take-off at the edge is 50 ms or more', () => {
    for (const x of [3260, 3400, 3900, 4500]) for (const intro of [true, false]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = pattern().build(x, 1, () => rv, intro);
      const blk = o.find((q) => q.t === 'block')!, ex = blk.x + blk.w!;
      const sp = o.filter((q) => q.t === 'spike');
      expect(blk.h).toBe(1);
      expect(sp.length).toBeGreaterThanOrEqual(3);
      expect(Math.min(...sp.map((q) => q.x))).toBeGreaterThanOrEqual(ex);
      const c: Course = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...o);
      // standing on the ledge, 0.6 s before the edge
      const r = createRunner(); r.x = blk.x + 0.3; r.y = 1;
      let ms = 0;
      for (let i = 0; i < 4000 && !r.dead && r.x < ex + 1; i++) {
        step(r, c, false);
        if (r.grounded && r.x > blk.x + 1 && r.x < ex - 0.5) {
          const w = jumpWindow(r, c, 1);
          if (w) { ms = (w.hi - w.lo + 1) * STEP * 1000; break; }
        }
      }
      expect(ms).toBeGreaterThanOrEqual(50);
      // no input: the runner falls off the edge into the spikes
      const q = createRunner(); q.x = blk.x + 0.3; q.y = 1;
      for (let i = 0; i < 4000 && !q.dead && q.x < sp[sp.length - 1]!.x + 3; i++) step(q, c, false);
      expect(q.dead).toBe('spike');
    }
  });

  it.each([7, 42, 1337])('seed %i is clearable through DROP LEDGES (to 3900m)', (seed) => {
    expect(clearable(createCourse(seed), 3900)).toBe(true);
  }, 240_000);
});
