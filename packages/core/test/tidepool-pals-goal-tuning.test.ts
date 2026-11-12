import { describe, expect, it } from 'vitest';
import { levelDef, validateLevel } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: goal counts retuned on off-band levels', () => {
  it('level 5 asks for more Sunstars, level 14 untangles 3 of its 4 nets, level 15 rescues 1 of its 2 pals', () => {
    expect(levelDef(5).goals).toEqual([{ t: 'rescue', n: 1 }, { t: 'collect', c: 1, n: 16 }]);
    expect(levelDef(14).goals).toEqual([{ t: 'litter' }, { t: 'ice', n: 3 }]);
    expect(levelDef(15).goals).toEqual([{ t: 'rescue', n: 1 }]);
  });

  it('leaves moves and boards alone, and the retuned levels stay valid', () => {
    expect([5, 14, 15].map((n) => levelDef(n).moves)).toEqual([20, 42, 34]);
    expect(levelDef(14).layout.join('').split('i').length - 1).toBe(4);
    expect(levelDef(15).layout.join('').split('P').length - 1).toBe(2);
    for (const n of [5, 14, 15]) expect(validateLevel(levelDef(n))).toEqual([]);
  });

  it('level 15 tells the player only one of the two pals needs rescuing', () => {
    expect(levelDef(15).intro).toMatch(/either one/);
  });
});
