import { describe, expect, it } from 'vitest';
import { GEARHOLD_BANDS, scoreGearhold } from '../src/hal/gearhold-score.js';
describe('gearhold repair-crystal supply', () => {
  it('keeps every level inside the reviewed supply band without losing other measures', () => {
    const r = scoreGearhold();
    expect(r.hardFailures).toEqual([]);
    for (const l of r.levels) {
      if (l.threat === 0) continue;
      const ratio = l.supply / l.threat;
      expect(ratio, l.name).toBeGreaterThanOrEqual(GEARHOLD_BANDS.minSupplyPerThreat);
      expect(ratio, l.name).toBeLessThanOrEqual(GEARHOLD_BANDS.maxSupplyPerThreat);
    }
    expect(r.measures).toEqual({ safeStarts: 100, supplied: 100, rising: 100, challenge: 100 });
  });
});
