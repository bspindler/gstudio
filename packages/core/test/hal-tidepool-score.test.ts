import { describe, expect, it, vi } from 'vitest';

import { levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';
import { tidepoolLevel } from '../src/hal/fixtures/tidepool-levels.js';
import { TIDEPOOL_BANDS, goalReachOf, inBandOf, levelTags, plusFiveOf, scoreTidepool, tierBand, varietyScore } from '../src/hal/tidepool-score.js';

// `frozen` plays the frozen copies of the levels (fixtures/tidepool-levels.ts) instead of the game's: a test that needs
// a level with a given character (one the robot cannot win) uses them, so retuning the game never touches this file.
const inject = vi.hoisted(() => ({ bad: false, frozen: false }));
vi.mock('../../../games/tidepool-pals/levels.js', async (orig) => {
  const real = await orig<typeof import('../../../games/tidepool-pals/levels.js')>();
  return {
    ...real,
    levelDef: (n: number) => (inject.frozen ? tidepoolLevel(n) : real.levelDef(n)),
    validateLevel: (def: Parameters<typeof real.validateLevel>[0]) =>
      inject.bad && def.n === 3 ? ['bad layout'] : real.validateLevel(def),
  };
});

describe('scoreTidepool', () => {
  it('pins the bands', () => {
    expect(TIDEPOOL_BANDS).toEqual({
      early: { upTo: 5 },
      tiers: [{ from: 1, band: [0.9, 1] }, { from: 6, band: [0.7, 0.95] }, { from: 16, band: [0.45, 0.85] }],
      wallDrop: 0.3,
      plusFive: { moves: 5, minLossRate: 0.05, helps: 0.2, target: 0.5, botMinConverted: 0.5 },
      variety: { target: 0.5 },
    });
  });

  it('win-rate bands are tiered, with a ceiling past the opening', () => {
    expect(tierBand(1)).toEqual([0.9, 1]);
    expect(tierBand(5)).toEqual([0.9, 1]);
    expect(tierBand(6)).toEqual([0.7, 0.95]);
    expect(tierBand(15)).toEqual([0.7, 0.95]);
    expect(tierBand(16)).toEqual([0.45, 0.85]);
    expect(tierBand(400)).toEqual([0.45, 0.85]);
  });

  it('inBand scores each level continuously against its tier', () => {
    expect(inBandOf(3, 1)).toBe(100);
    expect(inBandOf(3, 0.45)).toBeCloseTo(50, 5);
    expect(inBandOf(10, 0.8)).toBe(100);
    expect(inBandOf(10, 0.35)).toBeCloseTo(50, 5);
    expect(inBandOf(20, 0.6)).toBe(100);
    expect(inBandOf(20, 1)).toBe(0); // the ceiling: a level nobody loses past the opening is not in band
    expect(inBandOf(20, 0.925)).toBeCloseTo(50, 5);
  });

  it('goalReach only rewards near misses on levels below their band', () => {
    expect(goalReachOf(20, 0.6, 0.1)).toBe(100); // in band: how close its losses came is not scored
    expect(goalReachOf(20, 0.95, 0.1)).toBe(100); // above band: inBand already says so
    expect(goalReachOf(20, 0.3, 0.8)).toBeCloseTo(80, 5);
    expect(goalReachOf(10, 0.5, 0.25)).toBeCloseTo(25, 5);
  });

  it('plusFive: how many losses 5 more moves would turn into wins, and whether the offer helps', () => {
    // (win rate, with +5 moves, with the level's moves doubled)
    expect(plusFiveOf(1, 1, 1)).toEqual({ helps: null, score: null, botStuck: null }); // no losses: the offer never shows
    expect(plusFiveOf(0.97, 1, 1)).toEqual({ helps: null, score: null, botStuck: null }); // too few losses to judge
    expect(plusFiveOf(0.5, 0.75, 1)).toEqual({ helps: true, score: 100, botStuck: false });
    expect(plusFiveOf(0.5, 0.52, 0.9)).toMatchObject({ helps: false, botStuck: false });
    expect(plusFiveOf(0.5, 0.52, 0.9).score).toBeCloseTo(8, 5);
    expect(plusFiveOf(0, 0.1, 0.6).score).toBeCloseTo(20, 5);
  });

  it('plusFive gives no verdict where the robot fails whatever its move budget', () => {
    // Level 11 at review: 59% won, 60% with +5, 66% with +40: the robot's losses are its own blind spot, not the level.
    expect(plusFiveOf(0.59, 0.6, 0.66)).toEqual({ helps: null, score: null, botStuck: true });
    expect(plusFiveOf(0.5, 0.5, 0.74)).toEqual({ helps: null, score: null, botStuck: true }); // under half the losses
    expect(plusFiveOf(0.5, 0.5, 0.75)).toMatchObject({ helps: false, botStuck: false }); // half: judged
  });

  it('plusFive is reported beside fitness, never a measure (no ticket can target it, no gate can veto on it)', () => {
    const r = scoreTidepool({ from: 11, to: 13, seeds: 10 });
    expect(r.measures).not.toHaveProperty('plusFive');
    expect(r.noise).not.toHaveProperty('plusFive');
    expect(r.plusFive).toBeGreaterThanOrEqual(0);
    expect(r.plusFive).toBeLessThanOrEqual(100);
  });

  it('the robot-stuck levels get no +5 verdict and are listed', () => {
    inject.frozen = true; // frozen level 14: the swap robot (0.9.0) wins 65% and only 80% with doubled moves, whatever its budget
    let r: ReturnType<typeof scoreTidepool>;
    try { r = scoreTidepool({ from: 14, to: 14, seeds: 20 }); } finally { inject.frozen = false; }
    const l14 = r.levels[0]!;
    expect(l14.winRateDoubled).toBeGreaterThanOrEqual(l14.winRatePlusFive);
    expect(l14.botStuck).toBe(true);
    expect(l14.plusFiveHelps).toBeNull();
  });

  it('variety: back-to-back repeats score lower; the opening is left out', () => {
    const levelDef = tidepoolLevel; // frozen copies: two generated levels with the same tags, and a mixed run
    const a = levelDef(25), b = levelDef(26);
    expect(levelTags({ ...a, n: 10 })).toEqual(levelTags({ ...b, n: 11 }));
    expect(varietyScore([{ ...a, n: 10 }, { ...b, n: 11 }])).toBe(0);
    expect(varietyScore([levelDef(1), levelDef(2), levelDef(3)])).toBe(100); // pairs inside the opening don't count
    const mixed = varietyScore([levelDef(16), levelDef(17), levelDef(18), levelDef(19)]);
    expect(mixed).toBeGreaterThan(50);
    expect(mixed).toBeLessThanOrEqual(100);
    expect(levelTags(levelDef(19))).toEqual(expect.arrayContaining(['goal:rescue', 'goal:litter', 'tide:left', 'exit:left', 'stranded']));
  });

  it('lists the levels where +5 moves should not be offered', () => {
    const r = scoreTidepool({ from: 11, to: 16, seeds: 10 });
    for (const l of r.levels) {
      expect(l.winRatePlusFive).toBeGreaterThanOrEqual(l.winRate);
      expect(l.winRateDoubled).toBeGreaterThanOrEqual(l.winRatePlusFive);
      expect([true, false, null]).toContain(l.plusFiveHelps);
      expect([true, false, null]).toContain(l.botStuck);
      if (l.botStuck) expect(l.plusFiveHelps).toBeNull();
    }
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
    expect(Object.keys(r.measures)).toEqual(['inBand', 'noWalls', 'goalReach', 'variety', 'tension']);
    for (const l of r.levels) expect(l.closeWins!).toBeLessThanOrEqual(l.wins!);
    // fitness: the balance measures, not tension
    const vals = [r.measures.inBand!, r.measures.noWalls!, r.measures.goalReach!, r.measures.variety!];
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
