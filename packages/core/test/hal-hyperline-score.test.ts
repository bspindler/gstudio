import { describe, expect, it, vi } from 'vitest';

import { HYPERLINE_BANDS, scoreHyperline } from '../src/hal/hyperline-score.js';

// Injection targets only the clearability check: casual runs always see the real course.
const inject = vi.hoisted(() => ({ pitSeed: 0, unknownSeed: 0, inCasual: false }));
vi.mock('../../../games/hyperline/lib/course.js', async (orig) => {
  const real = await orig<typeof import('../../../games/hyperline/lib/course.js')>();
  return {
    ...real,
    createCourse: (seed: number) => {
      const c = real.createCourse(seed);
      if (inject.inCasual || seed !== inject.pitSeed) return c;
      c.nextX = 1e9;
      c.objs.push({ t: 'pit', x: 8, w: 14 });
      return c;
    },
  };
});
vi.mock('../src/hal/hyperline-bot.js', async (orig) => {
  const real = await orig<typeof import('../src/hal/hyperline-bot.js')>();
  return {
    ...real,
    casualRun: (seed: number, until: number) => {
      inject.inCasual = true;
      try { return real.casualRun(seed, until); } finally { inject.inCasual = false; }
    },
    clearable: (c: Parameters<typeof real.clearable>[0], until: number, budget?: number) =>
      c.seed === inject.unknownSeed ? 'unknown' : real.clearable(c, until, budget),
  };
});

const reset = () => { inject.pitSeed = 0; inject.unknownSeed = 0; };

describe('scoreHyperline', () => {
  it('pins the bands', () => {
    expect(HYPERLINE_BANDS).toEqual({ early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, spikeJump: 0.3 });
  });

  it('reports every sector, measures 0..100 and fitness as their mean', () => {
    reset();
    const r = scoreHyperline({ seeds: 8, until: 1900 });
    expect(r.game).toBe('hyperline');
    expect(r.levels.map((l) => l.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const l of r.levels) {
      expect(l.deathRate).toBeGreaterThanOrEqual(0);
      expect(l.deathRate).toBeLessThanOrEqual(1);
      expect(l.died).toBeLessThanOrEqual(l.reached);
      expect(Object.values(l.causes).reduce((a, b) => a + b, 0)).toBe(l.died);
    }
    expect(r.levels[0]!.reached).toBe(8);
    expect(Object.keys(r.measures)).toEqual(['inBand', 'noSpikes', 'reach']);
    const vals = Object.values(r.measures);
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(v).toBe(Math.round(v * 100) / 100);
    }
    expect(r.fitness).toBe(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100);
    expect(r.hardFailures).toEqual([]);
  }, 60_000);

  it('noSpikes only judges consecutive sectors that some run reached', () => {
    reset();
    const r = scoreHyperline({ seeds: 8, until: 1900 });
    const reached = r.levels.filter((l) => l.reached > 0);
    expect(reached.map((l) => l.sector)).toEqual(reached.map((_, i) => i));
    let spikes = 0;
    for (let i = 1; i < reached.length; i++) if (reached[i]!.deathRate - reached[i - 1]!.deathRate > HYPERLINE_BANDS.spikeJump) spikes++;
    const pairs = reached.length - 1;
    expect(r.measures.noSpikes).toBe(pairs ? Math.round(100 * (1 - spikes / pairs) * 100) / 100 : 100);
    // A course this short reaches only sector 0: no pairs, so no spikes.
    expect(scoreHyperline({ seeds: 2, until: 100 }).measures.noSpikes).toBe(100);
  }, 60_000);

  it('an unclearable seed is a hard failure, not a lower score', () => {
    reset();
    const clean = scoreHyperline({ seeds: 4, until: 1900 });
    inject.pitSeed = 3;
    try {
      const r = scoreHyperline({ seeds: 4, until: 1900 });
      expect(r.hardFailures).toEqual(['seed 3: not clearable to 1900m']);
      expect(r.measures).toEqual(clean.measures);
      expect(r.fitness).toBe(clean.fitness);
      expect(r.levels).toEqual(clean.levels);
    } finally { reset(); }
  }, 60_000);

  it('a budget-exhausted seed is reported as unknown', () => {
    reset();
    inject.unknownSeed = 2;
    try {
      expect(scoreHyperline({ seeds: 3, until: 400 }).hardFailures).toEqual(['seed 2: clearability unknown']);
    } finally { reset(); }
  }, 60_000);

  it('rejects seeds and until that are not positive integers', () => {
    for (const bad of [0, -1, 2.5, NaN, Infinity]) {
      expect(() => scoreHyperline({ seeds: bad, until: 1900 })).toThrow(Error);
      expect(() => scoreHyperline({ seeds: 3, until: bad })).toThrow(Error);
    }
  });

  it('a full 20-seed run finishes in under 30 s', () => {
    reset();
    const t = performance.now();
    scoreHyperline({ seeds: 20, until: 1900 });
    expect(performance.now() - t).toBeLessThan(30_000);
  }, 60_000);
});
