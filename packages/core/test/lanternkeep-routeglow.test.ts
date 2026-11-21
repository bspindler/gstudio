import { describe, expect, it } from 'vitest';

import { SWELL_SECONDS, createRouteGlow, swellShape } from '../../../games/lanternkeep/routeglow.js';

describe('lanternkeep route glow', () => {
  it('is idle between waves', () => {
    const r = createRouteGlow();
    expect(r.update({ phase: 'ready', waveIndex: -1 }, 1)).toBe(0);
  });

  it('swells when a wave starts, then fades to nothing', () => {
    const r = createRouteGlow();
    expect(r.update({ phase: 'wave', waveIndex: 0 }, 10)).toBe(0);
    const peak = r.update({ phase: 'wave', waveIndex: 0 }, 10.35);
    expect(peak).toBeGreaterThan(0.9);
    expect(r.update({ phase: 'wave', waveIndex: 0 }, 11.5)).toBeLessThan(peak);
    expect(r.update({ phase: 'wave', waveIndex: 0 }, 10 + SWELL_SECONDS + 0.1)).toBe(0);
  });

  it('swells again for the next wave and copes with the clock restarting', () => {
    const r = createRouteGlow();
    r.update({ phase: 'wave', waveIndex: 0 }, 10);
    r.update({ phase: 'wave', waveIndex: 0 }, 20);
    r.update({ phase: 'wave', waveIndex: 1 }, 30);
    expect(r.update({ phase: 'wave', waveIndex: 1 }, 30.4)).toBeGreaterThan(0.8);
    expect(r.update({ phase: 'wave', waveIndex: 1 }, 1)).toBe(0);
  });

  it('stays within 0..1', () => {
    for (let a = -1; a < 4; a += 0.05) {
      const v = swellShape(a);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
