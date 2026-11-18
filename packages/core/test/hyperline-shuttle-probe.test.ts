import { describe, expect, it } from 'vitest';

import { createCourse, PATTERNS, type Course } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { STEP } from '../../../games/hyperline/lib/world.js';
import { jumpWindow } from '../src/hal/hyperline-bot.js';

// The widest take-off window the casual player sees on a shuttle block, from 20 units back (far enough that the
// whole window is inside the planned path).
describe('hyperline shuttle take-off window', () => {
  it.each([true, false])('is 50 ms or more, and not a gift (under 200 ms), intro=%s', (intro) => {
    for (const x of [3520, 4000, 5200]) for (const rv of [0, 0.5, 0.99]) {
      const { o } = PATTERNS.find((q) => q.id === 'shuttle')!.build(x, 1, () => rv, intro);
      const c: Course = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...o.sort((a, b) => a.x - b.x));
      const r = createRunner(); r.x = x - 20;
      let ms = 0;
      for (let i = 0; i < 4000 && !r.dead; i++) {
        step(r, c, false);
        if (r.grounded) { const w = jumpWindow(r, c, 1.2); if (w) { ms = (w.hi - w.lo + 1) * STEP * 1000; break; } }
      }
      expect(ms).toBeGreaterThanOrEqual(50);
      expect(ms).toBeLessThan(200);
    }
  });
});
