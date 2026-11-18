import { describe, expect, it } from 'vitest';
import { buildBoard, counter, mulberry32 } from '../../../games/tidepool-pals/board.js';
import { features, levelDef, validateLevel, withoutTides } from '../../../games/tidepool-pals/levels.js';

describe('tidepool pals: level 29, octopus board', () => {
  const def = levelDef(29);
  it('is valid with tides on and off, with a bubbled pal in the head', () => {
    expect(def.n).toBe(29);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
    expect(def.layout[3]![3]).toBe('B');
    expect(features(def).rescue).toBe(1);
    expect(features(def).holes).toBeGreaterThan(10);
    expect(def.pool).toBe(2);
  });
  it('leaves open rows beneath the bubbled pal', () => {
    for (const r of [4, 5]) expect(def.layout[r]![3]).toBe('.');
  });
  it('builds a bubbled pal on every seed', () => {
    for (let seed = 1; seed <= 5; seed++) expect(buildBoard(def, mulberry32(seed), counter(1))[3]![3]).toMatchObject({ k: expect.any(String) });
  });
});
