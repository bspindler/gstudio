import { describe, expect, it } from 'vitest';
import { features, levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: level 31, octopus pool with rock pools', () => {
  const def = levelDef(31);
  it('is valid with tides on and off', () => {
    expect(def.n).toBe(31);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
    expect(def.pool).toBe(3);
  });
  it('has rock pools, an upward tide and no stranded pal', () => {
    const f = features(def);
    expect(f.rock).toBeGreaterThan(0);
    expect(f.rescue).toBe(0);
    expect(def.tide?.dir).toBe('up');
    expect(def.goals.some((g: { t: string }) => g.t === 'rescue')).toBe(false);
  });
});
