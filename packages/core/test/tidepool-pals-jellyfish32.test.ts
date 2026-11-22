import { describe, expect, it } from 'vitest';
import { features, levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: level 32, jellyfish pool', () => {
  const def = levelDef(32);
  it('is valid with tides on and off', () => {
    expect(def.n).toBe(32);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
  });
  it('has a bubbled pal, sand, holes and no rock pools', () => {
    const f = features(def);
    expect(f.rescue).toBe(1);
    expect(f.sand).toBeGreaterThan(0);
    expect(f.holes).toBeGreaterThan(0);
    expect(f.rock).toBe(0);
    expect(def.goals.map((g: { t: string }) => g.t)).toEqual(['rescue', 'sand']);
  });
});
