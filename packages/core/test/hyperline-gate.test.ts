import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Course, type Obj } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { GATE_HI, GATE_LO, GATE_W, GRAV, JV, PS, SECTOR_LEN, sectorInfo } from '../../../games/hyperline/lib/world.js';
import { clearable } from '../src/hal/hyperline-bot.js';

const bare = (objs: Obj[]): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs); return c; };

/** Runs to x=30 on an empty track with one gate at gx; jumps once at jumpAt (or never). */
function runGate(gx: number, jumpAt: number | null) {
  const c = bare([{ t: 'gate', x: gx, w: GATE_W, y: GATE_LO, h: GATE_HI }]);
  const r = createRunner();
  const evs: string[] = [];
  let jumped = false;
  while (!r.dead && r.x < 30) {
    const j = jumpAt !== null && !jumped && r.x >= jumpAt;
    if (j) jumped = true;
    for (const e of step(r, c, j)) evs.push(e.t);
  }
  return { dead: r.dead, evs };
}

describe('hyperline slot gates', () => {
  it('SLOT GATES is sector 7 for players and introduces the gate', () => {
    expect(INTRO[6]).toBe('gate');
    expect(sectorInfo(6).name).toBe('SLOT GATES');
    expect(sectorInfo(7).name).toBe('SWEEP COLUMNS');
    expect(sectorInfo(11).name).toBe('HYPERCORE');
  });

  it('SWEEP COLUMNS opens with a row of gates, first seen in sector 8, and the bot clears it', () => {
    expect(INTRO[7]).toBe('sweep');
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 2100);
      const first = c.objs.find((o) => o.p === 'sweep');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(7 * SECTOR_LEN);
      expect(first!.x).toBeLessThan(7 * SECTOR_LEN + 40);
      expect(c.objs.filter((o) => o.p === 'sweep' && o.g === first!.g && o.t === 'gate').length).toBeGreaterThanOrEqual(2);
    }
    const p = PATTERNS.find((q) => q.id === 'sweep')!;
    for (const d of [0.2, 1]) {
      let k = 0.1;
      const { o, len } = p.build(14, d, () => (k = (k + 0.37) % 1));
      expect(clearable(bare(o), 14 + len + 5)).toBe(true);
    }
  });

  it('the slot is a real gap: a jump fits through, but its apex is too tall to sail over', () => {
    const apexTop = (JV * JV) / (2 * GRAV) + PS;
    expect(GATE_HI).toBeLessThan(apexTop);
    expect(GATE_HI - GATE_LO).toBeGreaterThan(PS + 1);
    expect(GATE_LO).toBeGreaterThan(0.3);
  });

  it('running along the ground crashes into the gate post', () => {
    expect(runGate(12, null).dead).toBe('gate');
  });

  it('some jump timing slips through the slot and scores a gate event', () => {
    const ok = [];
    for (let j = 4; j < 12; j += 0.05) { const res = runGate(12, j); if (!res.dead) ok.push(res); }
    expect(ok.length).toBeGreaterThan(0);
    expect(ok[0]!.evs).toContain('gate');
  });

  it('a jump that peaks inside the gate hits the top slab', () => {
    const dead = new Set<string>();
    for (let j = 4; j < 12; j += 0.05) dead.add(runGate(12, j).dead);
    expect(dead.has('gate')).toBe(true);
  });

  it('gates first appear at the start of sector 7, never earlier', () => {
    for (const seed of [1, 2, 3, 99]) {
      const c = createCourse(seed); extendCourse(c, 1900);
      const first = c.objs.find((o) => o.t === 'gate');
      expect(first).toBeDefined();
      expect(first!.x).toBeGreaterThanOrEqual(6 * SECTOR_LEN);
      expect(first!.x).toBeLessThan(6 * SECTOR_LEN + 40);
    }
  });

  it('the bot clears a lone gate', () => {
    expect(clearable(bare([{ t: 'gate', x: 14, w: GATE_W, y: GATE_LO, h: GATE_HI }]), 30)).toBe(true);
  });
});
