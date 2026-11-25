import { describe, expect, it } from 'vitest';
import { LAST_HAND_LEVEL, features, levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: level 33, seahorse pool', () => {
  const def = levelDef(33);
  it('is valid with tides on and off', () => {
    expect(def.n).toBe(33);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
  });
  it('has nets, a stranded pal that exits down, and an upward tide', () => {
    const f = features(def);
    expect(f.ice).toBe(4);
    expect(f.rescue).toBe(1);
    expect(f.rock).toBe(0);
    expect(def.exit).toBe('down');
    expect(def.tide?.dir).toBe('up');
    expect(def.goals.map((g: { t: string }) => g.t)).toEqual(['rescue', 'ice']);
  });
  it('is the last hand-built level', () => {
    expect(LAST_HAND_LEVEL).toBe(33);
  });
});
