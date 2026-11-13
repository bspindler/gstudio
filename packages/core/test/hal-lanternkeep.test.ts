import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import type { Level } from '../../../games/lanternkeep/lib/sim.js';
import { LANTERNKEEP_BANDS, lanternkeepProblems, nightMeasures, playLanternkeep, scoreLanternkeep, SCORERS, type NightStats } from '../src/hal/index.js';

const night = (n: number, winRate: number): NightStats => ({ n, name: `n${n}`, plays: 16, wins: Math.round(winRate * 16), winRate, closeWins: 0, avgLivesFrac: 1, errors: [] });

describe('hal lanternkeep: measures', () => {
  it('lets the opening be easy but not the rest', () => {
    const early = Array.from({ length: LANTERNKEEP_BANDS.early.upTo }, (_, i) => night(i + 1, 1));
    expect(nightMeasures(early, 0.5).inBand).toBe(100);
    expect(nightMeasures([...early, night(6, 1)], 0.5).inBand).toBeLessThan(100);
    expect(nightMeasures([...early, night(6, 0.7)], 0.5).inBand).toBe(100);
    expect(nightMeasures([night(1, 0.5)], 0.5).inBand).toBe(0);
  });

  it('counts a sudden fall in win rate as a spike, not a rise', () => {
    expect(nightMeasures([night(6, 0.9), night(7, 0.5)], 0.5).noSpikes).toBe(0);
    expect(nightMeasures([night(6, 0.5), night(7, 0.9)], 0.5).noSpikes).toBe(100);
  });

  it('scores Night Watch reach inside its band', () => {
    expect(nightMeasures([], 0.45).watch).toBe(100);
    expect(nightMeasures([], 0.1).watch).toBeLessThan(50);
    expect(nightMeasures([], 1).watch).toBe(0);
  });
});

describe('hal lanternkeep: hard failures', () => {
  const base = LEVELS[0]!;
  const broken = (patch: Partial<Level>) => lanternkeepProblems({ ...base, ...patch });

  it('accepts every shipped night', () => {
    for (const l of LEVELS) expect(lanternkeepProblems(l)).toEqual([]);
  });

  it('catches bad paths, creatures and economies', () => {
    expect(broken({ paths: [[[4, 0], [4, 11]]] })).toContain('path 1 does not start off the board');
    expect(broken({ paths: [[[4, -1], [6, 3]]] })[0]).toMatch(/diagonal/);
    expect(broken({ paths: [[[4, -1], [4, 6], [2, 6], [2, 4], [6, 4]]] })).toContain('path 1 crosses itself');
    expect(broken({ paths: [[[4, -1], [4, 11]], [[9, 5], [6, 5]]] })).toContain('path 2 does not end on the lantern');
    expect(broken({ waves: [[['dragon' as never, 3, 1]]] })).toContain('unknown creature dragon');
    expect(broken({ gold: 10 })).toContain('not enough starting gold for any plant');
    expect(broken({ waves: [] })).toContain('no waves');
  });

  it('flags a night that planting nothing can win', () => {
    const trivial: Level = { ...base, waves: [[['moth', 1, 1]]], lives: 20 };
    expect(playLanternkeep(trivial, { maxTowers: 0 }).won).toBe(true);
  });
});

describe('hal lanternkeep: scorer', () => {
  it('is registered and validates its range', () => {
    expect(SCORERS.lanternkeep!.validate({ seeds: 0 })).toMatch(/seeds/);
    expect(SCORERS.lanternkeep!.validate({ seeds: 2 })).toBeNull();
  });

  it('scores the shipped game with no hard failures, deterministically', () => {
    const a = scoreLanternkeep({ seeds: 1 });
    expect(a.hardFailures).toEqual([]);
    expect(a.levels).toHaveLength(LEVELS.length);
    expect(Object.keys(a.measures).sort()).toEqual(['inBand', 'noSpikes', 'tension', 'watch']);
    expect(a.fitness).toBeGreaterThan(0);
    expect(scoreLanternkeep({ seeds: 1 })).toEqual(a);
  }, 60_000);
});
