import { describe, expect, it } from 'vitest';

import { createCourse, type Obj } from '../../../games/hyperline/lib/course.js';
import { createRunner, moverH, step, type Runner, type SimEvent } from '../../../games/hyperline/lib/sim.js';
import { BAR_Y, CEIL_Y, JV, GRAV, PS } from '../../../games/hyperline/lib/world.js';

// A hand-built course: generation switched off, only the objects given.
function only(objs: Obj[]) {
  const c = createCourse(1);
  c.objs.length = 0;
  c.nextX = 1e9;
  c.objs.push(...objs.sort((a, b) => a.x - b.x));
  return c;
}
function run(objs: Obj[], until: number, jump: (r: Runner) => boolean) {
  const c = only(objs), r = createRunner(), ev: SimEvent[] = [];
  let maxY = 0;
  while (r.x < until && !r.dead) { ev.push(...step(r, c, jump(r))); maxY = Math.max(maxY, r.y); }
  return { r, ev, maxY, c };
}

describe('hyperline sim: obstacle rules', () => {
  it('runs on flat track forever without input', () => {
    expect(run([], 60, () => false).r.dead).toBe('');
  });

  it('a normal jump peaks near JV^2 / 2G (fixed-step integration lands a little under)', () => {
    const { maxY } = run([], 20, (r) => r.x < 3);
    const apex = (JV * JV) / (2 * GRAV);
    expect(maxY).toBeLessThanOrEqual(apex);
    expect(maxY).toBeGreaterThan(apex * 0.95);
  });

  it('running under a low ceiling is safe; holding jump under it crashes', () => {
    const bar: Obj = { t: 'bar', x: 10, w: 4, y: BAR_Y };
    expect(run([{ ...bar }], 20, () => false).r.dead).toBe('');
    expect(run([{ ...bar }], 20, (r) => r.x > 9.5).r.dead).toBe('bar');
  });

  it('passing under a low ceiling emits a bar event', () => {
    const { ev } = run([{ t: 'bar', x: 10, w: 4, y: BAR_Y }], 20, () => false);
    expect(ev.filter((e) => e.t === 'bar')).toHaveLength(1);
  });

  it('a jump pad launches the runner far higher than a jump, with no input', () => {
    const { ev, maxY, r } = run([{ t: 'pad', x: 10, w: 1.6 }], 40, () => false);
    expect(ev.some((e) => e.t === 'pad')).toBe(true);
    expect(maxY).toBeGreaterThan((JV * JV) / (2 * GRAV) * 1.8);
    expect(r.dead).toBe('');
  });

  it('a gravity-flip zone carries the runner on the ceiling, then drops it back', () => {
    const c = only([{ t: 'flip', x: 10, w: 14 }]), r = createRunner(), ev: SimEvent[] = [];
    let onCeiling = false;
    while (r.x < 40 && !r.dead) {
      ev.push(...step(r, c, false));
      if (r.flip && r.grounded && Math.abs(r.y - (CEIL_Y - PS)) < 1e-9) onCeiling = true;
    }
    expect(onCeiling).toBe(true);
    expect(ev.map((e) => e.t).filter((t) => t.startsWith('flip'))).toEqual(['flipIn', 'flipOut']);
    expect(r.flip).toBe(false);
    expect(r.y).toBe(0);
    expect(r.dead).toBe('');
  });

  it('hanging spikes kill a runner on the ceiling unless it jumps down', () => {
    const objs = (): Obj[] => [{ t: 'flip', x: 10, w: 18 }, { t: 'spike', x: 20, y: CEIL_Y, inv: true }];
    expect(run(objs(), 30, () => false).r.dead).toBe('spike');
    expect(run(objs(), 30, (r) => r.flip && r.x > 17.6 && r.x < 18.4).r.dead).toBe('');
  });

  it('a spike cleared by a hair is a near miss; a big clearance is not', () => {
    // At speed 7 a jump started 2 units early clears the spike high; started late, it skims it.
    const high = run([{ t: 'spike', x: 10, y: 0 }], 20, (r) => r.x > 7.2 && r.x < 7.4);
    expect(high.r.dead).toBe('');
    expect(high.ev.some((e) => e.t === 'clear')).toBe(true);
    expect(high.ev.some((e) => e.t === 'near')).toBe(false);
    let found = false;
    for (let s = 5.0; s < 9.5 && !found; s += 0.05) {
      const t = run([{ t: 'spike', x: 10, y: 0 }], 20, (r) => r.x > s && r.x < s + 0.07);
      if (!t.r.dead && t.ev.some((e) => e.t === 'near')) found = true;
    }
    expect(found).toBe(true);
  });

  it('counts the spikes cleared in one jump on landing', () => {
    const spikes: Obj[] = [0, 1, 2].map((i) => ({ t: 'spike', x: 10 + i * 0.8, y: 0 }));
    let landed = 0;
    for (let s = 6.0; s < 9.0; s += 0.05) {
      const t = run(spikes.map((o) => ({ ...o })), 20, (r) => r.x > s && r.x < s + 0.07);
      const land = t.ev.find((e) => e.t === 'land');
      if (!t.r.dead && land && land.t === 'land') { landed = Math.max(landed, land.spikes); }
    }
    expect(landed).toBe(3);
  });

  it('chips are collected on contact and missed chips are reported', () => {
    const { ev } = run([{ t: 'chip', x: 10, y: 0.45 }, { t: 'chip', x: 14, y: 2.7 }], 20, () => false);
    expect(ev.filter((e) => e.t === 'chip')).toHaveLength(1);
    expect(ev.filter((e) => e.t === 'chipMiss')).toHaveLength(1);
  });

  it('a moving platform carries the runner across a pit', () => {
    const mover: Obj = { t: 'mover', x: 12, w: 3, base: 0.75, amp: 0.45, k: 0.55, ph: 0 };
    const c = only([{ t: 'pit', x: 10, w: 7 }, mover]);
    let best: Runner | null = null;
    for (let s = 6; s < 9.5 && !best; s += 0.1) {
      const r = createRunner();
      let rode = false;
      const c2 = only([{ t: 'pit', x: 10, w: 7 }, { ...mover }]);
      while (r.x < 25 && !r.dead) {
        const onIt = r.grounded && r.x + PS > 12 && r.x < 15;
        if (onIt && Math.abs(r.y - moverH(mover, r.x)) < 1e-9) rode = true;
        step(r, c2, (r.x > s && r.x < s + 0.12) || (rode && r.grounded && r.x > 13.4));
      }
      if (!r.dead && rode) best = r;
    }
    expect(c.objs).toHaveLength(2);
    expect(best).not.toBeNull();
  });

  it('falling into a pit ends the run', () => {
    expect(run([{ t: 'pit', x: 10, w: 6 }], 30, () => false).r.dead).toBe('fall');
  });
});
