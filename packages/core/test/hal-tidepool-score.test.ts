import { describe, expect, it } from 'vitest';

import { levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';
import { TIDEPOOL_BANDS, scoreTidepool } from '../src/hal/tidepool-score.js';

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
    expect(Object.keys(r.measures)).toEqual(['inBand', 'noWalls', 'goalReach']);
    const vals = Object.values(r.measures);
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
});
