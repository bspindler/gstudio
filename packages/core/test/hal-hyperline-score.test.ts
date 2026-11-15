import { describe, expect, it, vi } from 'vitest';

import { PATTERNS } from '../../../games/hyperline/lib/course.js';
import { type CasualRun, type Met, work } from '../src/hal/hyperline-bot.js';
import { bitesScore, chainedDist, fairScore, HYPERLINE_BANDS, reachScore, scoreHyperline, sectorMeasures, type SectorStats } from '../src/hal/hyperline-score.js';
import { HYPERLINE_UNTIL } from '../src/hal/scorers.js';
import { tensionMeasure } from '../src/hal/tension.js';
import { SECTOR_LEN, sectorAt } from '../../../games/hyperline/lib/world.js';

/** The step budget per sector played (see the budget test below): 70M over the 8 sectors the default run played. */
const STEP_BUDGET_PER_SECTOR = 8_750_000;

// pitSeed / unknownSeed target only the clearability check: casual runs always see the real course. earlySpike changes
// the casual player's sector 0 (an extra spike cluster), to show later sectors don't move. seamPitSeed puts an
// unjumpable pit across the sector 1/2 seam of the full course (createCourse(seed) from 0, the course daily mode
// plays) only: no per-sector course and no casual run ever crosses that seam.
const inject = vi.hoisted(() => ({ pitSeed: 0, unknownSeed: 0, seamPitSeed: 0, inCasual: false, empty: false, earlySpike: false }));
const clearableCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../../games/hyperline/lib/course.js', async (orig) => {
  const real = await orig<typeof import('../../../games/hyperline/lib/course.js')>();
  return {
    ...real,
    createCourse: (seed: number, startX = 0) => {
      const c = real.createCourse(seed, startX);
      if (inject.empty) { c.nextX = 1e9; return c; } // no obstacles at all: every run finishes
      if (inject.earlySpike && startX === 0) {
        real.extendCourse(c, 200);
        const x = c.nextX;
        c.objs.push({ t: 'spike', x: x + 1, y: 0, inv: false }, { t: 'spike', x: x + 1.8, y: 0, inv: false });
        c.nextX = x + 7;
      }
      if (!inject.inCasual && seed === inject.seamPitSeed && startX === 0) {
        const x = 2 * 250 - 6; // 6 m before the sector 2 seam, 14 m wide: no jump clears it
        real.extendCourse(c, x + 40);
        c.objs = c.objs.filter((o) => o.x < x - 2 || o.x > x + 16);
        c.objs.splice(c.objs.findIndex((o) => o.x > x), 0, { t: 'pit', x, w: 14 }); // objs stay sorted by x
      }
      if (inject.inCasual || seed !== inject.pitSeed) return c;
      c.nextX = 1e9;
      c.objs.push({ t: 'pit', x: startX + 8, w: 14 });
      return c;
    },
  };
});
vi.mock('../src/hal/hyperline-bot.js', async (orig) => {
  const real = await orig<typeof import('../src/hal/hyperline-bot.js')>();
  return {
    ...real,
    casualRun: (...args: Parameters<typeof real.casualRun>) => {
      inject.inCasual = true;
      try { return real.casualRun(...args); } finally { inject.inCasual = false; }
    },
    clearable: (...args: Parameters<typeof real.clearable>) => {
      clearableCalls.n++;
      return args[0].seed === inject.unknownSeed ? 'unknown' : real.clearable(...args);
    },
  };
});

const reset = () => { inject.pitSeed = 0; inject.unknownSeed = 0; inject.seamPitSeed = 0; inject.empty = false; inject.earlySpike = false; };

const sec = (sector: number, reached: number, died: number): SectorStats =>
  ({ sector, reached, died, deathRate: reached ? died / reached : 0, causes: died ? { spike: died } : {}, clears: 0, nears: 0, close: 0 });
const met = (p: string, ...ms: number[]): Met[] => ms.map((m) => ({ p, ms: m, off: 0 }));
const run = (o: Partial<CasualRun>): CasualRun =>
  ({ dist: 0, sector: 0, cause: '', jumps: 0, windows: [], killer: '', enc: {}, clears: 0, nears: 0, ...o });

describe('scoreHyperline', () => {
  it('pins the bands', () => {
    expect(HYPERLINE_BANDS).toEqual({
      early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, maxSurvive: 0.97, spikeJump: 0.3, minSample: 8,
      reach: { lo: 0.35, hi: 0.65, ref: 2650 },
      fair: { quantile: 0.1, minMs: 50 }, bites: [0.03, 0.25],
    });
  });

  it('reports every sector from its own start, measures 0..100, fitness the balance measures\' mean, tension beside it', () => {
    reset();
    const r = scoreHyperline({ seeds: 8, until: 1900 });
    expect(r.game).toBe('hyperline');
    expect(r.levels.map((l) => l.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const l of r.levels) {
      expect(l.reached).toBe(8); // every sector gets the same sample
      expect(l.deathRate).toBeGreaterThanOrEqual(0);
      expect(l.deathRate).toBeLessThanOrEqual(1);
      expect(l.died).toBeLessThanOrEqual(l.reached);
      expect(Object.values(l.causes).reduce((a, b) => a + b, 0)).toBe(l.died);
    }
    expect(Object.keys(r.measures)).toEqual(['inBand', 'noSpikes', 'reach', 'fair', 'bites', 'tension']);
    for (const v of Object.values(r.measures)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(v).toBe(Math.round(v * 100) / 100);
    }
    const { tension, ...balance } = r.measures;
    const vals = Object.values(balance);
    expect(r.fitness).toBe(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100);
    expect(tension).toBe(tensionMeasure(r.levels.map((l) => ({ n: l.sector, wins: l.reached - l.died, close: l.close })), { skipUpTo: HYPERLINE_BANDS.early.upTo }));
    expect(r.hardFailures).toEqual([]);
  }, 60_000);

  it('near misses fire in real runs, so tension has something to count', () => {
    reset();
    const r = scoreHyperline({ seeds: 20, until: 1900 });
    expect(r.levels.reduce((a, l) => a + l.clears, 0)).toBeGreaterThan(0);
    expect(r.levels.reduce((a, l) => a + l.nears, 0)).toBeGreaterThan(0);
    for (const l of r.levels) expect(l.close).toBeLessThanOrEqual(l.reached - l.died);
  }, 60_000);

  it('a change to an early sector does not reshuffle later ones (each sector is played from its own start)', () => {
    reset();
    const clean = scoreHyperline({ seeds: 8, until: 1000 });
    inject.earlySpike = true;
    try {
      const r = scoreHyperline({ seeds: 8, until: 1000 });
      expect(r.levels.slice(1)).toEqual(clean.levels.slice(1));
    } finally { reset(); }
  }, 60_000);

  it('sees a CRUMBLE change: pits 45% wider change the report', () => {
    reset();
    // Played up to the end of the sector CRUMBLE belongs to, wherever the game puts it.
    const crumble = PATTERNS.find((p) => p.id === 'crumble')!, build = crumble.build;
    const at = crumble.sector, until = (at + 1) * SECTOR_LEN;
    const before = scoreHyperline({ seeds: 20, until });
    crumble.build = (x, d, r) => {
      const out = build(x, d, r);
      for (const o of out.o) if (o.t === 'pit') o.w = o.w! * 1.45;
      return out;
    };
    try {
      const after = scoreHyperline({ seeds: 20, until });
      expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
      expect(after.levels[at]).not.toEqual(before.levels[at]);
    } finally { crumble.build = build; }
  }, 120_000);

  it('noSpikes judges every consecutive pair once each sector has minSample runs', () => {
    reset();
    const r = scoreHyperline({ seeds: 8, until: 1900 });
    let spikes = 0;
    for (let i = 1; i < r.levels.length; i++) if (r.levels[i]!.deathRate - r.levels[i - 1]!.deathRate > HYPERLINE_BANDS.spikeJump) spikes++;
    expect(r.measures.noSpikes).toBe(Math.round(100 * (1 - spikes / (r.levels.length - 1)) * 100) / 100);
    // A course this short has only sector 0: no pairs, so no spikes.
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

  it('reach is 100 inside [lo, hi] of reach.ref and falls linearly to 0 at 0 and at 1', () => {
    expect(reachScore(0.5)).toBe(100);
    expect(reachScore(0.35)).toBe(100);
    expect(reachScore(0.65)).toBe(100);
    expect(reachScore(0.9)).toBeLessThan(100);
    expect(reachScore(0.9)).toBeCloseTo((100 * 0.1) / 0.35, 6);
    expect(reachScore(0.175)).toBeCloseTo(50, 6);
    expect(reachScore(0)).toBe(0);
    expect(reachScore(1)).toBe(0);
  });

  it("reach chains a seed's sector runs: the distance of the first sector it died in, else until", () => {
    const bySector = [
      [run({ dist: 250 }), run({ dist: 250 })],
      [run({ dist: 300, cause: 'spike' }), run({ dist: 500 })],
      [run({ dist: 600, cause: 'fall' }), run({ dist: 600 })],
    ];
    expect(chainedDist(bySector, 0, 600)).toBe(300);
    expect(chainedDist(bySector, 1, 600)).toBe(600);
  });

  it('reach is measured against a fixed distance, so a longer course (a new sector) does not lower it', () => {
    reset();
    // Both courses run past the median distance, so the extra sector only adds runs the median never reaches.
    const a = scoreHyperline({ seeds: 8, until: 2400 });
    const b = scoreHyperline({ seeds: 8, until: 2400 + 250 });
    expect(b.levels.length).toBe(a.levels.length + 1);
    expect(b.measures.reach).toBe(a.measures.reach);
    expect(HYPERLINE_BANDS.reach.ref).toBeGreaterThan(0);
  }, 60_000);

  it('inBand needs sectors 2+ to be no easier than maxSurvive; sectors 0-1 keep only the lower bound', () => {
    // All sectors survive 100%: sectors 0-1 are in band, 2-3 are too easy.
    expect(sectorMeasures([sec(0, 20, 0), sec(1, 20, 0), sec(2, 20, 0), sec(3, 20, 0)], 0.5).inBand).toBe(50);
    // 97% survival is still in band.
    expect(sectorMeasures([sec(0, 100, 0), sec(1, 100, 0), sec(2, 100, 3)], 0.5).inBand).toBe(100);
  });

  it("fair: each pattern's p10 tap window against minMs, linear below it, averaged over patterns with minSample windows", () => {
    expect(fairScore([...met('a', ...Array(20).fill(80)), ...met('b', ...Array(20).fill(25))])).toBe(75);
    // p10 of ten windows 0, 10, ..., 90 ms is 10 ms: 20 points.
    expect(fairScore(met('a', 0, 10, 20, 30, 40, 50, 60, 70, 80, 90))).toBe(20);
    // Too few windows to judge: ignored, and no pattern to judge scores 100.
    expect(fairScore(met('a', ...Array(7).fill(0)))).toBe(100);
    expect(fairScore([])).toBe(100);
  });

  it("bites: each sector's intro kills 3-25% per encounter; an intro that never asks for a tap is not judged", () => {
    const sector = (p: string, kills: number, n: number, taps = n) => Array.from({ length: n }, (_, i) =>
      run({ killer: i < kills ? p : '', cause: i < kills ? 'spike' : '', enc: { [p]: 1 }, windows: met(p, ...(i < taps ? [100] : [])) }));
    // Sector 3 'twin' kills 10%: in band. Sector 4 'mover' kills none: 0 points.
    expect(bitesScore([[], [], [], sector('twin', 2, 20), sector('mover', 0, 20)])).toBe(50);
    // Sector 1's bars never ask for a tap (no windows): left out.
    expect(bitesScore([[], sector('bar', 0, 20, 0), [], sector('twin', 2, 20)])).toBe(100);
    // 50% kills: halfway from 25% to 100% kills: 2/3 of the way down.
    expect(bitesScore([[], [], [], sector('twin', 10, 20)])).toBeCloseTo((100 * 0.5) / 0.75, 1);
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
      expect(r.hardFailures.length).toBeGreaterThan(0);
      for (const f of r.hardFailures) expect(f).toMatch(/^seed 3, (sector \d+|full course): not clearable from \d+m to \d+m$/);
      expect(r.hardFailures).toContain('seed 3, full course: not clearable from 0m to 1900m');
      expect(r.measures).toEqual(clean.measures);
      expect(r.fitness).toBe(clean.fitness);
      expect(r.levels).toEqual(clean.levels);
    } finally { reset(); }
  }, 60_000);

  it('a budget-exhausted seed is reported as unknown (its casual run dies, so the search runs)', () => {
    reset();
    inject.unknownSeed = 3;
    try {
      const f = scoreHyperline({ seeds: 3, until: 1900 }).hardFailures;
      expect(f.length).toBeGreaterThan(0);
      for (const x of f) expect(x).toMatch(/^seed 3, (sector \d+|full course): clearability unknown$/);
      expect(f).toContain('seed 3, full course: clearability unknown');
    } finally { reset(); }
  }, 60_000);

  it('checks the full course from 0 too (daily mode plays it): a pattern unclearable only across a sector seam is caught', () => {
    reset();
    const clean = scoreHyperline({ seeds: 4, until: 1000 });
    inject.seamPitSeed = 2;
    try {
      const r = scoreHyperline({ seeds: 4, until: 1000 });
      expect(r.hardFailures).toEqual(['seed 2, full course: not clearable from 0m to 1000m']);
      expect(r.levels).toEqual(clean.levels); // the casual player never crosses a seam: only the hard check sees it
    } finally { reset(); }
  }, 60_000);

  it('rejects seeds and until that are not positive integers', () => {
    for (const bad of [0, -1, 2.5, NaN, Infinity]) {
      expect(() => scoreHyperline({ seeds: bad, until: 1900 })).toThrow(Error);
      expect(() => scoreHyperline({ seeds: 3, until: bad })).toThrow(Error);
    }
  });

  // Scoring cost is budgeted in simulation steps, not wall-clock time: the same code took 30.4 s and 32.0 s on CI
  // (measurement v2, P1.4). The default run took 24.9M steps (about 10 s on Brian's Mac) on 2026-11-15; the budget
  // leaves room for a few more sectors and still catches a planner that searches much more than it should.
  // Raised to 60M with the human-timing player (measurement v2, P2): it scans each hazard's tap window (some 40 short
  // tap simulations per hazard, to aim at the middle) instead of two searches per 15 Hz decision, and it survives
  // further. The default run took 49.8M steps (about 17 s on Brian's Mac) on 2026-11-15.
  // P3 plays every sector from its own start (100 runs per sector, not 100 runs that thin out), and the player reuses
  // one no-input walk for all the taps that land on it: 49.7M steps, about 15 s, on 2026-11-15. The budget stays.
  // The full-course clearability check from 0 (daily mode's course, the only one that crosses sector seams) is back
  // beside the per-sector checks: +7.0M steps, 56.7M in all, about 23 s with other jobs running, on 2026-11-15.
  // Raised to 70M so one more sector still fits.
  // Permission split A (2026-11-15): the budget is per sector the default run plays (70M over 8 sectors then), so a
  // sector the game adds brings its own share and never fails this test; a planner that searches much more still does.
  const SECTORS_PLAYED = sectorAt(HYPERLINE_UNTIL - 1) + 1;
  const STEP_BUDGET = SECTORS_PLAYED * STEP_BUDGET_PER_SECTOR;
  it(`a full default run (100 seeds to HYPERLINE_UNTIL) takes under ${STEP_BUDGET_PER_SECTOR / 1e6}M simulation steps per sector`, () => {
    reset();
    work.steps = 0;
    scoreHyperline({ seeds: 100, until: HYPERLINE_UNTIL });
    expect(work.steps).toBeGreaterThan(0);
    expect(work.steps).toBeLessThan(STEP_BUDGET);
  }, 120_000);

  it('a seed whose casual run finished skips that sector\'s clearability search (it already cleared that course)', () => {
    reset();
    inject.empty = true; // every casual run finishes
    clearableCalls.n = 0;
    try {
      expect(scoreHyperline({ seeds: 4, until: 400 }).hardFailures).toEqual([]);
      // Only the full-course check from 0 runs, once per seed: no casual run plays that course across the seams.
      expect(clearableCalls.n).toBe(4);
    } finally { reset(); }
  });
});
