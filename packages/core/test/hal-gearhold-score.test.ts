import { describe, expect, it, vi } from 'vitest';

import { LEVELS } from '../../../games/gearhold/levels.js';
import { GEARHOLD_BANDS, scoreGearhold } from '../src/hal/gearhold-score.js';

type TestLevel = { name: string; hint: string; map: string[] };
const inject = vi.hoisted(() => ({ bad: false, levels: null as null | TestLevel[] }));
vi.mock('../../../games/gearhold/levels.js', async (orig) => {
  const real = await orig<typeof import('../../../games/gearhold/levels.js')>();
  const broken = { name: 'Broken', hint: 'x', map: ['#####', '#S#X#', '#####', '#####', '#####'] };
  return { ...real, get LEVELS() { return inject.levels ?? (inject.bad ? [...real.LEVELS, broken] : real.LEVELS); } };
});

describe('scoreGearhold', () => {
  it('pins the bands', () => {
    expect(GEARHOLD_BANDS).toEqual({ maxStartThreat: 0, minSupplyPerThreat: 0.1, maxSupplyPerThreat: 1.0, wallRatio: 2, minThreatPerStep: 0.05 });
  });

  it('reports one MapStats per level with 0..100 measures and mean fitness', () => {
    inject.bad = false;
    const r = scoreGearhold();
    expect(r.game).toBe('gearhold');
    expect(r.levels).toHaveLength(LEVELS.length);
    expect(Object.keys(r.measures)).toEqual(['safeStarts', 'supplied', 'rising', 'challenge']);
    const vals = Object.values(r.measures);
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    expect(r.fitness).toBeCloseTo(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
    expect(r.hardFailures).toEqual([]);
  });

  it('injected broken level is a hard failure and leaves the other measures alone', () => {
    inject.bad = false;
    const clean = scoreGearhold();
    inject.bad = true;
    try {
      const r = scoreGearhold();
      expect(r.hardFailures).toContain(`level ${LEVELS.length}: exit unreachable`);
      expect(r.measures).toEqual(clean.measures);
    } finally { inject.bad = false; }
  });

  describe('two-sided bands on injected corridors', () => {
    // One straight corridor: S, then `row` (dots, threats, crystals), then X. routeLen = row.length.
    const corridor = (row: string): TestLevel => {
      const w = row.length + 4, wall = '#'.repeat(w);
      return { name: row, hint: 'x', map: [wall, `#S${row}X#`, wall, wall, wall] };
    };
    const score = (...rows: string[]) => {
      inject.levels = rows.map(corridor);
      try { return scoreGearhold(); } finally { inject.levels = null; }
    };
    const dots = (n: number) => '.'.repeat(n);
    // 2 threat over 23 steps = 0.087 per step: a normal level, inside the wall floor of 2 x 0.05.
    const normal = `${dots(10)}d${dots(12)}`;

    it('the corridors are valid levels', () => {
      const r = score(normal, dots(10));
      expect(r.hardFailures).toEqual([]);
      expect(r.levels.map((l) => [l.routeLen, l.threat, l.startThreat])).toEqual([[23, 2, 0], [10, 0, 0]]);
    });

    it('a level with zero threat and zero supply counts as supplied', () => {
      expect(score(dots(10)).measures.supplied).toBe(100);
    });

    it('supply far above threat is not supplied; supply equal to threat is', () => {
      expect(score(`${dots(8)}c..hhhhh..`).measures.supplied).toBe(0);
      expect(score(`${dots(8)}c..h..`).measures.supplied).toBe(100);
    });

    it('a later level with no threat lowers challenge', () => {
      expect(score(normal, normal, normal).measures.challenge).toBe(100);
      expect(score(normal, normal, dots(20)).measures.challenge).toBe(50);
      expect(score(dots(20)).measures.challenge).toBe(100); // one level: nothing to judge
    });

    it('a quiet first level followed by a normal one is not a wall', () => {
      expect(score(dots(20), normal).measures.rising).toBe(100);
      // A real jump still is: 7 threat over 20 steps = 0.35 > 2 x 0.087.
      expect(score(normal, `${dots(6)}b..d${dots(10)}`).measures.rising).toBe(0);
    });

    it('walls compare raw threatPerStep, not the rounded display value', () => {
      // 2/23 = 0.0870 (shown 0.09) then 7/40 = 0.175 (shown 0.18): 0.175 > 2 x 0.0870 is a wall,
      // though 0.18 > 2 x 0.09 would not be.
      const r = score(normal, `${dots(10)}b..d${dots(26)}`);
      expect(r.levels.map((l) => l.threatPerStep)).toEqual([0.09, 0.18]);
      expect(r.measures.rising).toBe(0);
    });
  });
});
