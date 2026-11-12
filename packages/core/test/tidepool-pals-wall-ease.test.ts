import { describe, expect, it } from 'vitest';
import { levelDef, validateLevel } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: levels the scorer still flagged as walls get gentler', () => {
  it('level 14 has a lighter litter band, with the same moves, nets and goals', () => {
    const def = levelDef(14);
    expect(def.layout.slice(6)).toEqual(['l.....l', 'll...ll']);
    expect(def.layout.join('').split('l').length - 1).toBe(6);
    expect(def.layout.join('').split('i').length - 1).toBe(4);
    expect(def.moves).toBe(42);
    expect(def.goals).toEqual([{ t: 'litter' }, { t: 'ice', n: 3 }]);
  });

  it('level 28 starts its stranded pal closer to the open water, with the same moves and goals', () => {
    const def = levelDef(28);
    expect(def.layout).toEqual(['.......', '.......', '.......', '.......', '...P...', '.......', '...l...', 'lllllll']);
    expect(def.moves).toBe(40);
    expect(def.goals).toEqual([{ t: 'rescue', n: 1 }, { t: 'litter' }]);
  });

  it('the eased levels stay valid, with and without tides', () => {
    for (const n of [14, 28]) expect(validateLevel(levelDef(n))).toEqual([]);
  });
});
