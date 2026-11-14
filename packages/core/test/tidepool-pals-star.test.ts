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
});
