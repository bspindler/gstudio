import { describe, expect, it } from 'vitest';

import { COLS, ROWS, buildBoard, counter, hasMoves, mulberry32 } from '../../../games/tidepool-pals/board.js';
import {
  AUTHORED, difficulty, features, generateLevel, levelDef, validateLevel,
} from '../../../games/tidepool-pals/levels.js';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('tidepool levels: hand-authored 1-20', () => {
  it('has exactly 20 levels, numbered in order', () => {
    expect(AUTHORED).toHaveLength(20);
    AUTHORED.forEach((d, i) => expect(d.n).toBe(i + 1));
  });

  it.each(range(1, 20))('level %i is solvable-shaped', (n) => {
    const def = levelDef(n);
    expect(validateLevel(def)).toEqual([]);
    expect(def.layout).toHaveLength(ROWS);
    for (const row of def.layout) expect(row).toHaveLength(COLS);
    // the board it builds always has a move
    for (let seed = 1; seed <= 5; seed++) expect(hasMoves(buildBoard(def, mulberry32(seed), counter()))).toBe(true);
  });

  it('introduces one mechanic at a time, starting with plain collecting', () => {
    const first = (pred: (n: number) => boolean) => range(1, 20).find(pred);
    const f = (n: number) => features(levelDef(n));
    expect(f(1)).toMatchObject({ sand: 0, ice: 0, holes: 0, collectGoals: 1 });
    const intro = {
      twoColour: first((n) => f(n).collectGoals >= 2),
      sand: first((n) => f(n).sand > 0),
      mask: first((n) => f(n).holes > 0),
      ice: first((n) => f(n).ice > 0),
    };
    for (const v of Object.values(intro)) expect(v).toBeDefined();
    expect(new Set(Object.values(intro)).size).toBe(4);
    // every authored level after the intro says what is new when it brings a mechanic in
    for (const n of Object.values(intro)) expect(levelDef(n!).intro).toBeTruthy();
  });
});

describe('tidepool levels: procedural generator beyond 20', () => {
  it('is deterministic for a level number', () => {
    for (const n of [21, 37, 64, 150, 999]) expect(generateLevel(n)).toEqual(generateLevel(n));
    expect(generateLevel(40)).not.toEqual(generateLevel(41));
  });

  it.each(range(21, 220))('generated level %i is valid', (n) => {
    expect(validateLevel(levelDef(n))).toEqual([]);
  });

  it('generated boards always start with a move', () => {
    for (const n of range(21, 80)) expect(hasMoves(buildBoard(levelDef(n), mulberry32(n), counter()))).toBe(true);
  });

  it('ramps difficulty, window over window (monotonic-ish), and keeps ramping past 21', () => {
    const windows = [range(21, 30), range(31, 45), range(46, 70), range(71, 110)];
    const d = windows.map((w) => mean(w.map((n) => difficulty(levelDef(n)))));
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
    expect(mean(range(21, 30).map((n) => difficulty(levelDef(n)))))
      .toBeGreaterThan(mean(range(1, 10).map((n) => difficulty(levelDef(n)))));
  });

  it('ramps through features (obstacles, holes, goals), not only targets and moves', () => {
    const load = (n: number) => { const f = features(levelDef(n)); return f.sand + f.ice + f.holes + 4 * f.goals; };
    expect(mean(range(71, 110).map(load))).toBeGreaterThan(mean(range(21, 30).map(load)) * 1.3);
    const late = range(60, 110).map((n) => features(levelDef(n)));
    expect(late.some((f) => f.goals >= 3)).toBe(true);
    expect(late.some((f) => f.holes > 0)).toBe(true);
  });

  it('never exceeds sane limits however high the level goes', () => {
    for (const n of [500, 5000, 50000]) {
      const def = levelDef(n);
      expect(validateLevel(def)).toEqual([]);
      expect(def.moves).toBeGreaterThanOrEqual(14);
    }
  });
});
