import { describe, expect, it } from 'vitest';

import { createCourse, extendCourse, INTRO } from '../../../games/hyperline/lib/course.js';
import {
  applyEvent, checkMissions, clampStart, freshSave, isPractice, migrateSave, newRunStats, runCredits, sectorStart,
} from '../../../games/hyperline/lib/meta.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { SECTOR_LEN, sectorAt } from '../../../games/hyperline/lib/world.js';

describe('hyperline practice starts from a reached sector', () => {
  it('a sector starts at its 250m mark', () => {
    expect([1, 2, 7, 8].map(sectorStart)).toEqual([0, 250, 1500, 1750]);
    expect(sectorStart(0)).toBe(0);
  });

  it('the picker only offers sectors already reached', () => {
    expect(clampStart(7, 7)).toBe(7);
    expect(clampStart(9, 7)).toBe(7);
    expect(clampStart(0, 7)).toBe(1);
    expect(clampStart(3, 1)).toBe(1);
  });

  it('a normal run is not practice; a run from sector 7 is', () => {
    expect(isPractice(newRunStats('endless'))).toBe(false);
    const s = newRunStats('endless', 7);
    expect(isPractice(s)).toBe(true);
    expect([s.dist, s.from, s.sector]).toEqual([1500, 1500, 7]);
  });

  it('practice pays credits only for distance actually run', () => {
    let s = newRunStats('endless', 7);
    s = { ...s, dist: 1600 };
    expect(runCredits(s)).toBe(20);
    s = applyEvent(s, { t: 'chip' });
    expect(runCredits(s)).toBe(23);
  });

  it('practice runs never complete missions', () => {
    let s = newRunStats('endless', 6);
    for (let i = 0; i < 40; i++) s = applyEvent(s, { t: 'chip' });
    expect(checkMissions(['chips40', 'sector5', 'dist300'], { ...s, dist: 3000 })).toEqual([]);
    let n = newRunStats('endless');
    for (let i = 0; i < 40; i++) n = applyEvent(n, { t: 'chip' });
    expect(checkMissions(['chips40'], n)).toEqual(['chips40']);
  });

  it('a course from a sector opens with that sector\'s new obstacle, after the usual lead-in', () => {
    for (const [sec, id] of Object.entries(INTRO)) {
      const from = Number(sec) * SECTOR_LEN;
      const c = createCourse(42, from);
      extendCourse(c, from + 90);
      expect(c.objs.length).toBeGreaterThan(0);
      expect(c.objs[0]!.x).toBeGreaterThanOrEqual(from + 24);
      expect(c.objs[0]!.p).toBe(id);
    }
  });

  it('the runner runs from the chosen sector and stays in it at the start', () => {
    const from = sectorStart(7), c = createCourse(9, from), r = createRunner();
    r.x += from;
    for (let i = 0; i < 60; i++) step(r, c, false);
    expect(r.dead).toBe('');
    expect(sectorAt(r.x) + 1).toBe(7);
  });
});

describe('hyperline save remembers the furthest sector', () => {
  it('a fresh save has reached sector 1', () => {
    expect(freshSave().far).toBe(1);
  });

  it('keeps the furthest sector through a reload', () => {
    expect(migrateSave({ ...freshSave(), far: 7 }).far).toBe(7);
    expect(migrateSave({ ...freshSave(), far: -3 }).far).toBe(1);
  });

  it('older saves infer it from their best endless distance', () => {
    expect(migrateSave({ v: 2, credits: 0, owned: { volt: 1 }, eq: 'volt', best: 812, runs: 3 }).far).toBe(4);
  });
});
