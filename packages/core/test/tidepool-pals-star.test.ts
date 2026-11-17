import { describe, expect, it } from 'vitest';
import { buildBoard, counter, mulberry32 } from '../../../games/tidepool-pals/board.js';
import { features, levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: level 23, starfish board', () => {
  it('is valid with tides on and off, with a bubbled pal in the centre', () => {
    const def = levelDef(23);
    expect(def.n).toBe(23);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
    expect(def.layout[3]![3]).toBe('B');
    expect(features(def).rescue).toBe(1);
    expect(features(def).holes).toBeGreaterThan(10);
    expect(def.pool).toBe(2);
    const g = buildBoard(def, mulberry32(3), counter(1));
    expect(g[3]![3]).toMatchObject({ k: 'bubble', hp: 2 });
  });
  it('level 24, the crab pool, is valid with litter and 8 moves', () => {
    const def = levelDef(24);
    expect(def.n).toBe(24);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
    expect(def.moves).toBe(8);
    expect(features(def).litter).toBe(8);
    expect(def.pool).toBe(2);
  });
  it('level 25, the seahorse pool, has a stranded pal in the middle and a colour goal', () => {
    const def = levelDef(25);
    expect(def.n).toBe(25);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
    expect(def.layout[3]![3]).toBe('P');
    expect(def.exit).toBe('down');
    expect(def.goals.map((g: { t: string }) => g.t)).toEqual(['rescue', 'collect']);
    expect(features(def).holes).toBeGreaterThan(10);
    expect(def.pool).toBe(2);
    for (let seed = 1; seed <= 5; seed++) expect(buildBoard(def, mulberry32(seed), counter(1))[3]![3]).toMatchObject({ k: 'lost' });
  });
});
