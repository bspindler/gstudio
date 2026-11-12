import { describe, expect, it, vi } from 'vitest';

import { levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';
import { TIDEPOOL_BANDS, scoreTidepool } from '../src/hal/tidepool-score.js';

const inject = vi.hoisted(() => ({ bad: false }));
vi.mock('../../../games/tidepool-pals/levels.js', async (orig) => {
  const real = await orig<typeof import('../../../games/tidepool-pals/levels.js')>();
  return {
    ...real,
    validateLevel: (def: Parameters<typeof real.validateLevel>[0]) =>
      inject.bad && def.n === 3 ? ['bad layout'] : real.validateLevel(def),
  };
});

describe('scoreTidepool', () => {
  it('pins the bands', () => {
    expect(TIDEPOOL_BANDS).toEqual({ early: { upTo: 5, minWin: 0.9 }, minWin: 0.25, wallDrop: 0.3 });
  });

  it('reports every level in range', () => {
    const r = scoreTidepool({ from: 1, to: 6, seeds: 4 });
    expect(r.game).toBe('tidepool-pals');
    expect(r.levels.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const l of r.levels) {
      expect(l.winRate).toBeGreaterThanOrEqual(0);
      expect(l.winRate).toBeLessThanOrEqual(1);
    }
  });

  it('measures are 0..100 and fitness is their mean', () => {
    const r = scoreTidepool({ from: 1, to: 6, seeds: 4 });
    expect(Object.keys(r.measures)).toEqual(['inBand', 'noWalls', 'goalReach', 'tension']);
    for (const l of r.levels) expect(l.closeWins!).toBeLessThanOrEqual(l.wins!);
    const vals = [r.measures.inBand!, r.measures.noWalls!, r.measures.goalReach!]; // fitness: the balance measures, not tension
    expect(r.measures.tension).toBeGreaterThanOrEqual(0);
    expect(r.measures.tension).toBeLessThanOrEqual(100);
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(r.fitness).toBeCloseTo(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
  });

  it('invalid levels are hard failures, not a lower score', () => {
    const r = scoreTidepool({ from: 1, to: 40, seeds: 1 });
    const expected = r.levels.flatMap((l) => l.errors.map((e) => `level ${l.n}: ${e}`));
    expect(r.hardFailures).toEqual(expected);
    for (const l of r.levels) {
      const def = levelDef(l.n);
      const errs = [...new Set([...validateLevel(def), ...validateLevel(withoutTides(def))])];
      expect(l.errors).toEqual(errs);
    }
    expect(scoreTidepool({ from: 1, to: 30, seeds: 1 }).hardFailures).toEqual([]);
  });

  it('small run is fast', () => {
    const t = Date.now();
    scoreTidepool({ from: 1, to: 10, seeds: 5 });
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('injected invalid level is reported exactly once and never changes the score', () => {
    inject.bad = false;
    const clean = scoreTidepool({ from: 1, to: 6, seeds: 3 });
    inject.bad = true;
    try {
      const r = scoreTidepool({ from: 1, to: 6, seeds: 3 });
      expect(r.hardFailures).toEqual(['level 3: bad layout']);
      expect(r.levels.find((l) => l.n === 3)!.errors).toEqual(['bad layout']);
      expect(r.measures).toEqual(clean.measures);
      expect(r.fitness).toBe(clean.fitness);
    } finally {
      inject.bad = false;
    }
  });

  it('rejects an empty level range', () => {
    expect(() => scoreTidepool({ from: 5, to: 4, seeds: 3 })).toThrow(Error);
  });

  it('rejects fewer than one seed', () => {
    expect(() => scoreTidepool({ from: 1, to: 3, seeds: 0 })).toThrow(Error);
    expect(() => scoreTidepool({ from: NaN, to: 3, seeds: 1 })).toThrow(Error);
    expect(() => scoreTidepool({ from: 0, to: 3, seeds: 1 })).toThrow(Error);
    expect(() => scoreTidepool({ from: 1, to: 3, seeds: 2.5 })).toThrow(Error);
    expect(() => scoreTidepool({ from: 1, to: 3, seeds: Infinity })).toThrow(Error);
    expect(() => scoreTidepool({ from: 1, to: Infinity, seeds: 1 })).toThrow(Error);
  });
});
