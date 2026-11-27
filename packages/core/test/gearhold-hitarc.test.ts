import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS module without types
import { hitArcLife, hitArcOpacity, HIT_ARC_FADE } from '../../../games/gearhold/hitarc.js';

describe('gearhold hit arc', () => {
  it('fades out in about 0.4 s', () => {
    expect(HIT_ARC_FADE).toBeCloseTo(0.4);
    expect(hitArcLife(1, 0.2)).toBeCloseTo(0.5);
    expect(hitArcLife(1, 0.4)).toBe(0);
    expect(hitArcLife(0.1, 5)).toBe(0);
  });
  it('stays faint and goes to zero', () => {
    expect(hitArcOpacity(1)).toBeLessThanOrEqual(0.6);
    expect(hitArcOpacity(1)).toBeGreaterThan(hitArcOpacity(0.5));
    expect(hitArcOpacity(0)).toBe(0);
  });
});
