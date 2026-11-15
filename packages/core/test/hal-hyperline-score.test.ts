import { describe, expect, it, vi } from 'vitest';

import { HYPERLINE_BANDS, reachScore, scoreHyperline, sectorMeasures, type SectorStats } from '../src/hal/hyperline-score.js';

// Injection targets only the clearability check: casual runs always see the real course.
const inject = vi.hoisted(() => ({ pitSeed: 0, unknownSeed: 0, inCasual: false, empty: false }));
vi.mock('../../../games/hyperline/lib/course.js', async (orig) => {
  const real = await orig<typeof import('../../../games/hyperline/lib/course.js')>();
  return {
    ...real,
    createCourse: (seed: number) => {
      const c = real.createCourse(seed);
      if (inject.empty) { c.nextX = 1e9; return c; } // no obstacles at all: every run finishes
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

const reset = () => { inject.pitSeed = 0; inject.unknownSeed = 0; inject.empty = false; };

const sec = (sector: number, reached: number, died: number): SectorStats =>
  ({ sector, reached, died, deathRate: reached ? died / reached : 0, causes: died ? { spike: died } : {} });

describe('scoreHyperline', () => {
  it('pins the bands', () => {
    expect(HYPERLINE_BANDS).toEqual({
      early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, maxSurvive: 0.97, spikeJump: 0.3, minSample: 8,
      reach: { lo: 0.35, hi: 0.65 },
    });
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

  it('noSpikes only judges consecutive sectors that were each reached by at least minSample runs', () => {
    reset();
    const r = scoreHyperline({ seeds: 20, until: 1900 });
    const big = r.levels.filter((l) => l.reached >= HYPERLINE_BANDS.minSample);
    expect(big.map((l) => l.sector)).toEqual(big.map((_, i) => i));
    let spikes = 0;
    for (let i = 1; i < big.length; i++) if (big[i]!.deathRate - big[i - 1]!.deathRate > HYPERLINE_BANDS.spikeJump) spikes++;
    const pairs = big.length - 1;
    expect(r.measures.noSpikes).toBe(pairs > 0 ? Math.round(100 * (1 - spikes / pairs) * 100) / 100 : 100);
    // A course this short reaches only sector 0: no pairs, so no spikes.
    expect(scoreHyperline({ seeds: 2, until: 100 }).measures.noSpikes).toBe(100);
  }, 60_000);

  it('a sector reached by fewer than minSample runs never counts as a spike', () => {
    // Sector 2 jumps from 22% to 100% deaths, but only 7 runs reached it.
    const levels = [sec(0, 20, 2), sec(1, 18, 4), sec(2, 7, 7)];
    expect(sectorMeasures(levels, 0.5).noSpikes).toBe(100);
    // The same jump on 8 runs is a spike: 1 of 2 pairs.
    expect(sectorMeasures([sec(0, 20, 2), sec(1, 18, 4), sec(2, 8, 8)], 0.5).noSpikes).toBe(50);
    // No pair with both sides sampled: 100.
    expect(sectorMeasures([sec(0, 7, 6), sec(1, 1, 1)], 0.5).noSpikes).toBe(100);
  });

  it('reach is 100 inside [lo, hi] of until and falls linearly to 0 at 0 and at 1', () => {
    expect(reachScore(0.5)).toBe(100);
    expect(reachScore(0.35)).toBe(100);
    expect(reachScore(0.65)).toBe(100);
    expect(reachScore(0.9)).toBeLessThan(100);
    expect(reachScore(0.9)).toBeCloseTo((100 * 0.1) / 0.35, 6);
    expect(reachScore(0.175)).toBeCloseTo(50, 6);
    expect(reachScore(0)).toBe(0);
    expect(reachScore(1)).toBe(0);
  });

  it('inBand needs sectors 2+ to be no easier than maxSurvive; sectors 0-1 keep only the lower bound', () => {
    // All sectors survive 100%: sectors 0-1 are in band, 2-3 are too easy.
    expect(sectorMeasures([sec(0, 20, 0), sec(1, 20, 0), sec(2, 20, 0), sec(3, 20, 0)], 0.5).inBand).toBe(50);
    // 97% survival is still in band.
    expect(sectorMeasures([sec(0, 100, 0), sec(1, 100, 0), sec(2, 100, 3)], 0.5).inBand).toBe(100);
  });

  it('a trivially easy game (no obstacles, every run finishes) scores reach < 100 and inBand < 100', () => {
    reset();
    inject.empty = true;
    try {
      const r = scoreHyperline({ seeds: 8, until: 1900 });
      expect(r.levels.every((l) => l.died === 0)).toBe(true);
      expect(r.measures.reach).toBeLessThan(100);
      expect(r.measures.inBand).toBeLessThan(100);
      expect(r.hardFailures).toEqual([]);
    } finally { reset(); }
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

  // The budget protects Hal's nightly run on Brian's Mac (30 s). Shared CI runners are slower and noisy (30.4 s and
  // 32.0 s on 2026-11-15 for the same code), so CI gets twice the room: it still catches a real slowdown.
  const budgetMs = process.env.CI ? 60_000 : 30_000;
  it(`a full default (100-seed) run finishes in under ${budgetMs / 1000} s`, () => {
    reset();
    const t = performance.now();
    scoreHyperline({ seeds: 100, until: 1900 });
    expect(performance.now() - t).toBeLessThan(budgetMs);
  }, budgetMs * 2);
});
