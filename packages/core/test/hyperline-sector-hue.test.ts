import { describe, expect, it } from 'vitest';
import { hueShiftHex, SECTOR_HUE, sectorHueShift } from '../../../games/hyperline/render.js';
import { SECTOR_LEN, speedAt } from '../../../games/hyperline/lib/world.js';

describe('hyperline sector hue drift', () => {
  it('is zero in sector 0 and at the boundary, so nothing pops', () => {
    expect(sectorHueShift(10)).toBe(0);
    expect(sectorHueShift(SECTOR_LEN)).toBe(0);
  });
  it('swells within the first second of a sector and is gone after it', () => {
    const x0 = SECTOR_LEN * 3, v = speedAt(x0);
    const mid = sectorHueShift(x0 + v * 0.5);
    expect(mid).toBeGreaterThan(SECTOR_HUE.deg * 0.9);
    expect(mid).toBeLessThanOrEqual(SECTOR_HUE.deg);
    expect(sectorHueShift(x0 + v * 1.2)).toBe(0);
    expect(sectorHueShift(x0 + SECTOR_LEN / 2)).toBe(0);
  });
  it('rotates hue but keeps grey and zero shift unchanged', () => {
    expect(hueShiftHex('#808080', 40)).toBe('#808080');
    expect(hueShiftHex('#FF0000', 120).toLowerCase()).toBe('#00ff00');
    expect(hueShiftHex('#22F0FF', 0).toLowerCase()).toBe('#22f0ff');
  });
});
