import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import type { Level } from '../../../games/lanternkeep/lib/sim.js';
import { PERKS, sparksSpent } from '../../../games/lanternkeep/lib/meta.js';
import {
  LANTERNKEEP_BANDS, LANTERNKEEP_STYLES, isCloseWin, lanternkeepProblems, nightMeasures, nightPerks, playLanternkeep, playWatch,
  scoreLanternkeep, SCORERS, typicalPerks, type LanternkeepPlay, type NightStats,
} from '../src/hal/index.js';

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

  it('scores Night Watch reach per style, so one style in band does not carry the rest', () => {
    expect(nightMeasures([], [0.45, 0.5, 0.4, 0.55]).watch).toBe(100);
    expect(nightMeasures([], [0.45, 1, 1, 1]).watch).toBe(25);
  });
});

describe('hal lanternkeep: close wins (operator decision D3)', () => {
  const p = (won: boolean, lives: number, maxLives = 20): LanternkeepPlay => ({ won, stars: won ? 1 : 0, lives, maxLives, wave: 1, towers: 1, gold: 0, flares: 0 });
  it('is a win with under half the lives left', () => {
    expect(isCloseWin(p(true, 9))).toBe(true);
    expect(isCloseWin(p(true, 10))).toBe(false);
    expect(isCloseWin(p(true, 18))).toBe(false); // missed three stars, but comfortable
    expect(isCloseWin(p(false, 0))).toBe(false);
    expect(isCloseWin(p(true, 11, 23))).toBe(true); // perk lives count in the whole
  });
});

describe('hal lanternkeep: typical perks', () => {
  it('spends the sparks a player has, in the order the perk screen lists them', () => {
    expect(typicalPerks(0)).toEqual([]);
    expect(typicalPerks(2)).toEqual([]);
    expect(typicalPerks(4)).toEqual(['wick']);
    expect(typicalPerks(10)).toEqual(['wick', 'purse', 'spores']);
    for (let s = 0; s <= 45; s++) expect(sparksSpent(typicalPerks(s))).toBeLessThanOrEqual(s);
    expect(typicalPerks(99)).toEqual(PERKS.map((x) => x.id));
  });

  it('gives night n the perks of about two stars per earlier night', () => {
    expect(nightPerks(1)).toEqual({});
    expect(nightPerks(3)).toEqual({ lives: 3 });
    expect(nightPerks(6)).toEqual({ lives: 3, gold: 40, glowcapDiscount: 0.2 });
  });
});

describe('hal lanternkeep: night watch plays', () => {
  it('play on until the lantern falls, not until a safety stop', () => {
    const p = playWatch(LANTERNKEEP_STYLES[0]!, 1);
    expect(p.won).toBe(false);
    expect(p.lives).toBe(0);
  }, 30_000);
});

describe('hal lanternkeep: bot spending', () => {
  // A long straight lane with a slow trickle of tough creatures: one plant can't hold it alone.
  const lane = (gold: number): Level => ({
    name: 't', intro: '', lives: 20, gold, towers: ['glowcap'], paths: [[[4, -1], [4, 12]]],
    waves: Array.from({ length: 6 }, () => [['beetle', 6, 1.5]] as Level['waves'][number]),
  });

  it('plants past its cap once every plant is fully grown and gold piles up', () => {
    const p = playLanternkeep(lane(3000), { maxTowers: 1 });
    expect(p.towers).toBeGreaterThan(1);
  });

  it('keeps its cap while gold is short or upgrades are off', () => {
    expect(playLanternkeep(lane(3000), { maxTowers: 1, upgrades: false }).towers).toBe(1);
    expect(playLanternkeep(lane(60), { maxTowers: 1 }).towers).toBeLessThanOrEqual(1);
  });

  it('stops hoarding on a hard night (night 14, four plants)', () => {
    const p = playLanternkeep(LEVELS[13]!, { maxTowers: 4, seed: 1 });
    expect(p.towers).toBeGreaterThan(4);
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
