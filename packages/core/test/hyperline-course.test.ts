import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO, PATTERNS, type Obj } from '../../../games/hyperline/lib/course.js';
import { dailySeed, mulberry32 } from '../../../games/hyperline/lib/rng.js';
import { AIR, BAR_H, BAR_Y, GRAV, JV, PS, SECTOR_LEN, sectorAt, sectorInfo, speedAt, STEP } from '../../../games/hyperline/lib/world.js';
import { clearable } from '../src/hal/hyperline-bot.js';

const course = (seed: number, until: number) => { const c = createCourse(seed); extendCourse(c, until); return c; };
const plain = (objs: Obj[]) => objs.map((o) => ({ ...o }));
const sectorOf = (id: string | undefined) => PATTERNS.find((p) => p.id === id)?.sector ?? -1;

describe('hyperline course generation', () => {
  it('the same seed builds an identical course', () => {
    expect(plain(course(42, 2000).objs)).toEqual(plain(course(42, 2000).objs));
  });

  it('different UTC dates build different daily courses', () => {
    const a = course(dailySeed('2026-11-07'), 600).objs, b = course(dailySeed('2026-11-08'), 600).objs;
    expect(plain(a)).not.toEqual(plain(b));
  });

  it('keeps objects sorted by x', () => {
    const xs = course(9, 2000).objs.map((o) => o.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
  });

  it('extending in steps gives the same course as extending at once', () => {
    const c = createCourse(77);
    for (let x = 50; x <= 1500; x += 50) extendCourse(c, x);
    expect(plain(c.objs)).toEqual(plain(course(77, 1500).objs));
  });
});

describe('hyperline sectors', () => {
  it('a new sector every 250m, with names and palettes beyond the authored list', () => {
    expect(SECTOR_LEN).toBe(250);
    expect(sectorAt(0)).toBe(0);
    expect(sectorAt(249.9)).toBe(0);
    expect(sectorAt(250)).toBe(1);
    for (let i = 0; i < 12; i++) {
      const s = sectorInfo(i);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.pal.sky).toHaveLength(3);
    }
  });

  it('difficulty keeps rising past the Apex distance', () => {
    expect(speedAt(700)).toBeGreaterThan(speedAt(300));
    expect(speedAt(1800)).toBeGreaterThan(speedAt(1400));
  });

  it('introduces each new obstacle in its own sector, in order, never earlier', () => {
    const order = Object.entries(INTRO).map(([s, id]) => [Number(s), id] as const).sort((a, b) => a[0] - b[0]);
    expect(order.map(([, id]) => id)).toEqual(['bar', 'padPit', 'twin', 'mover', 'flip', 'gate', 'sweep', 'pulse', 'crumble', 'boost', 'riser', 'stagger', 'drop', 'shuttle', 'pillars']);
    for (const seed of [1, 2, 3, 99, dailySeed('2026-11-07')]) {
      const objs = course(seed, 3800).objs;
      for (const [sector, id] of order) {
        const first = objs.find((o) => sectorOf(o.p) === sector);
        expect(first, `${id} in seed ${seed}`).toBeDefined();
        expect(first!.p).toBe(id);
        expect(first!.x).toBeGreaterThanOrEqual(sector * SECTOR_LEN);
        expect(first!.x).toBeLessThan(sector * SECTOR_LEN + 40);
      }
    }
  });
});

describe('hyperline patterns are clearable by construction', () => {
  const instances = () => {
    const out: { id: string; x: number; objs: Obj[]; len: number }[] = [];
    for (const p of PATTERNS) for (let x = p.sector * SECTOR_LEN + 5; x < 2200; x += 53) {
      const r = mulberry32(Math.floor(x * 31));
      for (let k = 0; k < 6; k++) {
        const { o, len } = p.build(x, Math.min(1, x / 900), r);
        out.push({ id: p.id, x, objs: o, len });
      }
    }
    return out;
  };

  it('plain pits never exceed the jump range at that speed', () => {
    for (const inst of instances()) {
      if (inst.objs.some((q) => q.t === 'pad' || q.t === 'mover' || q.t === 'flip')) continue;
      for (const o of inst.objs.filter((q) => q.t === 'pit')) {
        expect(o.w!, `${inst.id}@${inst.x}`).toBeLessThanOrEqual(speedAt(o.x) * AIR * 0.72);
      }
    }
  });

  it('low ceilings leave ground clearance and stand on solid track', () => {
    for (const inst of instances()) for (const b of inst.objs.filter((o) => o.t === 'bar')) {
      expect(b.y! - PS).toBeGreaterThanOrEqual(0.2);
      expect(b.y).toBe(BAR_Y);
      const under = inst.objs.filter((o) => o.t === 'pit' && o.x < b.x + b.w! && o.x + o.w! > b.x);
      expect(under).toEqual([]);
    }
  });

  it('a jump cannot pass over a low ceiling (it is taller than the jump apex)', () => {
    const apexTop = (JV * JV) / (2 * GRAV) + PS;
    expect(BAR_Y + BAR_H).toBeGreaterThan(apexTop);
  });

  it('chips sit within reach of a jump', () => {
    for (const inst of instances()) for (const c of inst.objs.filter((o) => o.t === 'chip')) {
      const padded = inst.objs.some((o) => o.t === 'pad');
      expect(c.y!).toBeLessThanOrEqual(padded ? 6 : (JV * JV) / (2 * GRAV) + PS + 0.4);
    }
  });

  it('every pattern reports a positive length that covers its objects', () => {
    for (const inst of instances()) {
      expect(inst.len).toBeGreaterThan(0);
      for (const o of inst.objs) expect(o.x + (o.w ?? 0.8)).toBeLessThanOrEqual(inst.x + inst.len + 0.81);
    }
  });
});

describe('hyperline courses are clearable end to end', () => {
  it.each([7, 42, 1337, 2024, dailySeed('2026-11-07'), dailySeed('2026-12-25')])('seed %i is clearable to 2150m', (seed) => {
    expect(clearable(createCourse(seed), 2150)).toBe(true);
  }, 120_000);

  it('the bot is not trivially optimistic: it fails an impossible pit', () => {
    const c = createCourse(5);
    c.objs.length = 0;
    c.nextX = 1e9;
    c.objs.push({ t: 'pit', x: 8, w: 14 });
    expect(clearable(c, 40)).toBe(false);
    expect(STEP).toBeCloseTo(1 / 120);
  });

  it('the bot fails a low ceiling right after a spike it must jump', () => {
    const c = createCourse(5);
    c.objs.length = 0;
    c.nextX = 1e9;
    c.objs.push({ t: 'spike', x: 8, y: 0 }, { t: 'spike', x: 8.8, y: 0 }, { t: 'bar', x: 9.6, w: 6, y: BAR_Y });
    expect(clearable(c, 30)).toBe(false);
  });
});
