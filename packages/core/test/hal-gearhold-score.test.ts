import { describe, expect, it, vi } from 'vitest';

import { LEVELS } from '../../../games/gearhold/levels.js';
import { GEARHOLD_BANDS, scoreGearhold } from '../src/hal/gearhold-score.js';

const inject = vi.hoisted(() => ({ bad: false }));
vi.mock('../../../games/gearhold/levels.js', async (orig) => {
  const real = await orig<typeof import('../../../games/gearhold/levels.js')>();
  const broken = { name: 'Broken', hint: 'x', map: ['#####', '#S#X#', '#####', '#####', '#####'] };
  return { ...real, get LEVELS() { return inject.bad ? [...real.LEVELS, broken] : real.LEVELS; } };
});

describe('scoreGearhold', () => {
  it('pins the bands', () => {
    expect(GEARHOLD_BANDS).toEqual({ maxStartThreat: 0, minSupplyPerThreat: 0.1, wallRatio: 2 });
  });

  it('reports one MapStats per level with 0..100 measures and mean fitness', () => {
    inject.bad = false;
    const r = scoreGearhold();
    expect(r.game).toBe('gearhold');
    expect(r.levels).toHaveLength(LEVELS.length);
    expect(Object.keys(r.measures)).toEqual(['safeStarts', 'supplied', 'rising']);
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
});
