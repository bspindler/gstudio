import { describe, expect, it } from 'vitest';

import { COLS, ROWS, buildBoard, counter, hasMoves, mulberry32 } from '../../../games/tidepool-pals/board.js';
import {
  AUTHORED, HELPER_LEVEL, MOVE_BONUS, difficulty, features, generateLevel, levelDef, levelFor, poolOf, validateLevel, withoutTides,
} from '../../../games/tidepool-pals/levels.js';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// New hand-made levels are welcome (Brian declines them, not a test): check every one, never a count.
describe('tidepool levels: hand-authored', () => {
  it('has the original 20 levels or more, numbered in order', () => {
    expect(AUTHORED.length).toBeGreaterThanOrEqual(20);
    AUTHORED.forEach((d, i) => expect(d.n).toBe(i + 1));
  });

  it.each(range(1, AUTHORED.length))('level %i is solvable-shaped, with tides on and off', (n) => {
    const def = levelDef(n);
    expect(validateLevel(def)).toEqual([]);
    expect(validateLevel(withoutTides(def))).toEqual([]);
    expect(def.layout).toHaveLength(ROWS);
    for (const row of def.layout) expect(row).toHaveLength(COLS);
    // the board it builds always has a move
    for (let seed = 1; seed <= 5; seed++) expect(hasMoves(buildBoard(def, mulberry32(seed), counter()))).toBe(true);
  });

  it('introduces one mechanic at a time, starting with plain collecting, and the tide arrives early', () => {
    const first = (pred: (n: number) => boolean) => range(1, 20).find(pred);
    const f = (n: number) => features(levelDef(n));
    expect(f(1)).toMatchObject({ sand: 0, litter: 0, ice: 0, holes: 0, rock: 0, rescue: 0, tide: false, collectGoals: 1 });
    const intro = {
      tide: first((n) => f(n).tide),
      twoColour: first((n) => f(n).collectGoals >= 2),
      rescue: first((n) => levelDef(n).layout.join('').includes('P')), // stranded pals; the bubble pal on 3 is taught separately
      rock: first((n) => f(n).rock > 0),
      litter: first((n) => f(n).litter > 0),
      sideways: first((n) => f(n).sideways),
      mask: first((n) => f(n).holes > 0),
      nets: first((n) => f(n).ice > 0),
    };
    for (const v of Object.values(intro)) expect(v).toBeDefined();
    expect(new Set(Object.values(intro)).size).toBe(Object.keys(intro).length);
    // every level that brings a mechanic in says what is new
    for (const n of Object.values(intro)) expect(levelDef(n!).intro).toBeTruthy();
    // the brief's curve: low tide about 3, helpers about 4, rescue about 5, rock pools about 6, sideways about 8
    expect(intro.tide).toBe(3);
    expect(HELPER_LEVEL).toBe(4);
    expect(levelDef(HELPER_LEVEL).intro).toMatch(/helper/i);
    expect(intro.rescue).toBe(5);
    expect(intro.rock).toBe(6);
    expect(intro.sideways).toBe(8);
    // the first low tide is gentle: short, after a long high tide
    const t3 = levelDef(3).tide!;
    expect(t3.low).toBeLessThanOrEqual(2);
    expect(t3.high).toBeGreaterThanOrEqual(5);
  });

  it('the first rescue keeps to the high tide (it only has to sink)', () => {
    const d = levelDef(5);
    expect(d.tide).toBeUndefined();
    expect(d.exit).toBe('down');
  });
});

describe('tidepool levels: reef pools', () => {
  it('tags every level with a pool: 1-10 pool 0, 11-20 pool 1, then every 10', () => {
    expect(range(1, 10).every((n) => levelFor(n).pool === 0)).toBe(true);
    expect(range(11, 20).every((n) => levelFor(n).pool === 1)).toBe(true);
    expect(levelFor(21).pool).toBe(2);
    expect(levelFor(30).pool).toBe(2);
    expect(levelFor(31).pool).toBe(3);
    expect(poolOf(105)).toBe(10);
  });
});

describe('tidepool levels: tides off (the tides flag)', () => {
  it('drops the tide, turns rock pools into water for good and moves rescue exits to the bottom', () => {
    const t = withoutTides(levelDef(20));
    expect(t.tide).toBeUndefined();
    expect(t.layout.join('')).not.toContain('o');
    expect(withoutTides(levelDef(11)).exit).toBe('down');
    expect(withoutTides(levelDef(5))).toBe(levelDef(5)); // no tide: unchanged
  });
});

describe('tidepool levels: procedural generator beyond 20', () => {
  it('is deterministic for a level number', () => {
    for (const n of [21, 37, 64, 150, 999]) expect(generateLevel(n)).toEqual(generateLevel(n));
    expect(generateLevel(40)).not.toEqual(generateLevel(41));
  });

  it.each(range(21, 220))('generated level %i is valid, with tides on and off', (n) => {
    expect(validateLevel(levelDef(n))).toEqual([]);
    expect(validateLevel(withoutTides(levelDef(n)))).toEqual([]);
  });

  it('generated boards always start with a move', () => {
    for (const n of range(21, 80)) expect(hasMoves(buildBoard(levelDef(n), mulberry32(n), counter()))).toBe(true);
  });

  it('mixes everything: tides in every direction, rock pools, rescues, litter and nets', () => {
    const fs = range(21, 120).map((n) => ({ f: features(levelDef(n)), d: levelDef(n) }));
    for (const dir of ['up', 'left', 'right']) expect(fs.some(({ d }) => d.tide?.dir === dir)).toBe(true);
    expect(fs.filter(({ f }) => f.tide).length).toBeGreaterThan(60);
    expect(fs.some(({ f }) => f.rock > 0)).toBe(true);
    expect(fs.some(({ f }) => f.rescue > 0)).toBe(true);
    expect(fs.some(({ d }) => d.exit === 'left' || d.exit === 'right')).toBe(true);
    expect(fs.some(({ f }) => f.litter > 0)).toBe(true);
    expect(fs.some(({ f }) => f.ice > 0)).toBe(true);
  });

  it('ramps difficulty, window over window (monotonic-ish), and keeps ramping past 21', () => {
    const windows = [range(21, 30), range(31, 45), range(46, 70), range(71, 110)];
    const d = windows.map((w) => mean(w.map((n) => difficulty(levelDef(n)))));
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
    expect(mean(range(21, 30).map((n) => difficulty(levelDef(n)))))
      .toBeGreaterThan(mean(range(1, 10).map((n) => difficulty(levelDef(n)))));
  });

  it('ramps through features (obstacles, holes, goals), not only targets and moves', () => {
    const load = (n: number) => { const f = features(levelDef(n)); return f.sand + f.litter + f.ice + f.holes + 4 * f.goals; };
    expect(mean(range(71, 110).map(load))).toBeGreaterThan(mean(range(21, 30).map(load)) * 1.3);
    const late = range(60, 110).map((n) => features(levelDef(n)));
    expect(late.some((f) => f.goals >= 3)).toBe(true);
    expect(late.some((f) => f.holes > 0)).toBe(true);
  });

  it('gives the levels that walled players extra moves, leaving their boards and goals alone', () => {
    for (const n of [11, 14, 15, 19]) expect(levelDef(n).moves).toBeGreaterThanOrEqual(32);
    for (const n of [25, 26, 28]) {
      const { moves, ...rest } = generateLevel(n);
      expect(MOVE_BONUS[n]).toBeGreaterThan(0);
      expect(moves).toBeLessThanOrEqual(45);
      expect(rest.layout).toHaveLength(ROWS);
    }
  });

  it('never exceeds sane limits however high the level goes', () => {
    for (const n of [500, 5000, 50000]) {
      const def = levelDef(n);
      expect(validateLevel(def)).toEqual([]);
      expect(def.moves).toBeGreaterThanOrEqual(14);
    }
  });
});
