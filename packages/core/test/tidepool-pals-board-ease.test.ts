import { describe, expect, it } from 'vitest';
import { features, generateLevel, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';

// The generator's output for these numbers, not levelDef: a new hand-made level 21 replaces generated 21, and that is fine.

describe('tidepool pals: lighter boards on walled generated levels', () => {
  it('level 21 has two fewer litter pieces and the same moves, goals and nets', () => {
    const def = generateLevel(21);
    expect(def.layout[6]).toBe('.......');
    expect(features(def).litter).toBe(7);
    expect(features(def).ice).toBe(3);
    expect(def.moves).toBe(22);
    expect(def.goals).toEqual([{ t: 'litter' }, { t: 'ice', n: 3 }]);
  });

  it('the eased level stays valid, with and without tides', () => {
    expect(validateLevel(generateLevel(21))).toEqual([]);
    expect(validateLevel(withoutTides(generateLevel(21)))).toEqual([]);
  });

  it('leaves neighbouring generated levels alone', () => {
    expect(generateLevel(22).layout[7]).toBe('lllllll');
    expect(generateLevel(24).layout[6]).toBe('l.....l');
  });
});
