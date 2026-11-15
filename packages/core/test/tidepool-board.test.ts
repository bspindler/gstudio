import { describe, expect, it } from 'vitest';

import {
  COLS, ROWS, buildBoard, cellsInEffect, collapse, comboEffect, counter, effectFor, goalStatus, goalsMet,
  group, hasMoves, largestGroup, maskOf, mulberry32, newProgress, addProgress, resolveTap, shuffle,
  specialForGroup, starsFor, type Cell, type Grid, type LevelDef,
} from '../../../games/tidepool-pals/board.js';

// Grid helpers: a row string per board row. Digits 0-4 are pals of that colour, 'I' + next digit is
// handled by `ice`, 's' sand, 'x' hole, 'B' bomb, 'H' horizontal wave, 'V' vertical wave, 'W' whirlpool
// (colour 0), '*' empty.
function grid(rows: string[], ice: [number, number][] = []): Grid {
  const id = counter();
  const g: Grid = rows.map((row) => [...row].map((ch): Cell | null => {
    if (ch === 'x' || ch === '*') return null;
    if (ch === 's') return { id: id(), k: 'sand' };
    if (ch === 'B') return { id: id(), k: 'sp', s: 'bomb', c: 0 };
    if (ch === 'H') return { id: id(), k: 'sp', s: 'wave-h', c: 0 };
    if (ch === 'V') return { id: id(), k: 'sp', s: 'wave-v', c: 0 };
    if (ch === 'W') return { id: id(), k: 'sp', s: 'whirl', c: 0 };
    return { id: id(), k: 'pal', c: Number(ch) };
  }));
  for (const [r, c] of ice) { const cell = g[r]![c]!; if (cell.k === 'pal') cell.ice = true; }
  return g;
}
const at = (g: Grid, r: number, c: number) => g[r]![c];
const key = (cells: [number, number][]) => cells.map(([r, c]) => `${r},${c}`).sort();

// A checkerboard of colours 1 and 2 has no groups at all, so it isolates whatever we place on it.
const CHECKER = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => String(((r + c) % 2) + 1)).join(''));
const put = (rows: string[], r: number, c: number, ch: string) =>
  rows.map((row, i) => (i === r ? row.slice(0, c) + ch + row.slice(c + 1) : row));

describe('tidepool board: groups and specials', () => {
  it('a group is the orthogonally connected free pals of one colour; frozen pals are not part of it', () => {
    const g = grid(['0011', '0122', '3333'], [[1, 0]]);
    expect(key(group(g, 0, 0))).toEqual(['0,0', '0,1']);
    expect(group(g, 1, 0)).toEqual([]); // frozen: not tappable
    expect(group(g, 2, 0)).toHaveLength(4);
  });

  it('picks the special by group size: 5+ bomb, 7+ wave by shape, 9+ whirlpool', () => {
    const row = (n: number) => Array.from({ length: n }, (_, i) => [0, i] as [number, number]);
    const col = (n: number) => Array.from({ length: n }, (_, i) => [i, 0] as [number, number]);
    expect(specialForGroup(row(4))).toBeNull();
    expect(specialForGroup(row(5))).toBe('bomb');
    expect(specialForGroup(row(6))).toBe('bomb');
    expect(specialForGroup(row(7))).toBe('wave-h');
    expect(specialForGroup(col(7))).toBe('wave-v');
    expect(specialForGroup(col(8))).toBe('wave-v');
    expect(specialForGroup([...row(5), [1, 0], [1, 1], [1, 2], [1, 3]])).toBe('whirl');
  });

  it('effects: bomb 3x3, waves a row or column, whirlpool every pal of its colour', () => {
    const g = grid(CHECKER);
    expect(cellsInEffect(g, 3, 3, effectFor({ id: 1, k: 'sp', s: 'bomb', c: 0 }))).toHaveLength(9);
    expect(cellsInEffect(g, 0, 0, effectFor({ id: 1, k: 'sp', s: 'bomb', c: 0 }))).toHaveLength(4);
    expect(key(cellsInEffect(g, 2, 4, effectFor({ id: 1, k: 'sp', s: 'wave-h', c: 0 }))))
      .toEqual(key(Array.from({ length: COLS }, (_, c) => [2, c])));
    expect(key(cellsInEffect(g, 2, 4, effectFor({ id: 1, k: 'sp', s: 'wave-v', c: 0 }))))
      .toEqual(key(Array.from({ length: ROWS }, (_, r) => [r, 4])));
    const whirl = cellsInEffect(g, 0, 0, effectFor({ id: 1, k: 'sp', s: 'whirl', c: 1 }));
    expect(whirl).toHaveLength((COLS * ROWS) / 2);
    expect(whirl.every(([r, c]) => (at(g, r, c) as { c: number }).c === 1)).toBe(true);
  });

  it('effects skip holes in the board mask', () => {
    const g = grid(['0x0x0x0', ...CHECKER.slice(1)]);
    expect(cellsInEffect(g, 0, 2, effectFor({ id: 1, k: 'sp', s: 'wave-h', c: 0 }))).toHaveLength(4);
  });

  it('combining: two bombs blast 5x5, two waves a cross, bomb+wave a thick cross', () => {
    const bomb = { id: 1, k: 'sp', s: 'bomb', c: 0 } as const;
    const h = { id: 2, k: 'sp', s: 'wave-h', c: 0 } as const;
    const v = { id: 3, k: 'sp', s: 'wave-v', c: 0 } as const;
    const g = grid(CHECKER);
    expect(cellsInEffect(g, 3, 3, comboEffect([bomb, bomb]))).toHaveLength(25);
    expect(cellsInEffect(g, 3, 3, comboEffect([h, v]))).toHaveLength(ROWS + COLS - 1);
    expect(cellsInEffect(g, 3, 3, comboEffect([h, h]))).toHaveLength(ROWS + COLS - 1);
    expect(cellsInEffect(g, 3, 3, comboEffect([bomb, h]))).toHaveLength(3 * COLS + 3 * ROWS - 9);
  });

  it('combining with whirlpools: whirl+whirl clears the board, whirl+bomb its colour plus 5x5', () => {
    const w1 = { id: 1, k: 'sp', s: 'whirl', c: 1 } as const;
    const w2 = { id: 2, k: 'sp', s: 'whirl', c: 2 } as const;
    const bomb = { id: 3, k: 'sp', s: 'bomb', c: 0 } as const;
    const g = grid(CHECKER);
    expect(cellsInEffect(g, 3, 3, comboEffect([w1, w2]))).toHaveLength(ROWS * COLS);
    const wb = cellsInEffect(g, 3, 3, comboEffect([w1, bomb]));
    // 28 colour-1 cells + the 12 or 13 colour-2 cells inside the 5x5
    expect(wb.length).toBe(28 + 25 - 13);
  });
});

describe('tidepool board: resolving a tap', () => {
  it('rejects taps on singles, sand, frozen pals and holes, leaving the grid alone', () => {
    const g = grid(['0120', 's1x2'], [[0, 3]]);
    const id = counter(100);
    expect(resolveTap(g, 0, 0, id).ok).toBe(false);
    expect(resolveTap(g, 1, 0, id).ok).toBe(false);
    expect(resolveTap(g, 0, 3, id).ok).toBe(false);
    expect(resolveTap(g, 1, 2, id).ok).toBe(false);
  });

  it('clears a group, counts colours, breaks adjacent sand and frees adjacent ice', () => {
    const g = grid(['s00s', '1002', '1s22'], [[1, 0]]);
    const r = resolveTap(g, 0, 1, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.kind).toBe('group');
    expect(r.counts.collect[0]).toBe(4);
    expect(r.counts.sand).toBe(3);
    expect(r.counts.ice).toBe(1);
    expect(at(r.grid, 0, 0)).toBeNull();
    expect(at(r.grid, 2, 1)).toBeNull();
    expect((at(r.grid, 1, 0) as { ice?: boolean }).ice).toBeFalsy();
    expect(at(g, 0, 0)).not.toBeNull(); // input untouched
  });

  it('a group of 5 leaves an urchin bomb where you tapped, in the group colour', () => {
    const g = grid(['00000', '12121']);
    const r = resolveTap(g, 0, 2, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.spawned).toMatchObject({ r: 0, c: 2, cell: { k: 'sp', s: 'bomb', c: 0 } });
    expect(at(r.grid, 0, 2)).toMatchObject({ k: 'sp', s: 'bomb' });
  });

  it('a lone special fires its own effect and chains into specials it hits', () => {
    const rows = put(put(CHECKER, 3, 3, 'B'), 4, 4, 'H');
    const r = resolveTap(grid(rows), 3, 3, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.kind).toBe('special');
    // 3x3 around (3,3) plus the rest of row 4
    expect(r.cleared).toHaveLength(9 + COLS - 3);
    expect(r.effects.map((e) => e.kind)).toEqual(['bomb', 'wave-h']);
  });

  it('tapping a special next to another special combines them', () => {
    const rows = put(put(CHECKER, 3, 3, 'B'), 3, 4, 'B');
    const r = resolveTap(grid(rows), 3, 3, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.kind).toBe('combo');
    expect(r.cleared).toHaveLength(25);
  });

  it('a blast frees frozen pals in its area instead of clearing them, and breaks sand', () => {
    const rows = put(put(CHECKER, 3, 3, 'B'), 2, 2, 's');
    const r = resolveTap(grid(rows, [[4, 4]]), 3, 3, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.counts.sand).toBe(1);
    expect(r.counts.ice).toBe(1);
    expect(at(r.grid, 4, 4)).toMatchObject({ k: 'pal' });
    expect(r.cleared).toHaveLength(7);
  });
});

describe('tidepool board: gravity, refills and moves', () => {
  it('collapse drops pals, keeps holes empty, and sand and frozen pals stay put', () => {
    const g = grid(['0*', 'x1', '*s', '2*'], [[3, 0]]);
    const mask = [[true, true], [false, true], [true, true], [true, true]];
    const { spawned } = collapse(g, mask, mulberry32(1), 5, counter(100));
    expect(at(g, 1, 0)).toBeNull(); // hole stays a hole
    expect(at(g, 2, 0)).toMatchObject({ k: 'pal', c: 0 }); // fell past the hole
    expect(at(g, 3, 0)).toMatchObject({ k: 'pal', c: 2, ice: true }); // frozen pal did not move
    expect(at(g, 2, 1)).toMatchObject({ k: 'sand' });
    expect(at(g, 1, 1)).toMatchObject({ k: 'pal', c: 1 });
    expect(at(g, 3, 1)).not.toBeNull(); // below the sand refills on its own
    expect(spawned.length).toBe(3);
    expect(spawned.every((s) => s.fromR < s.r)).toBe(true);
    for (const row of g) for (const cell of row) if (cell?.k === 'pal') expect(cell.c).toBeLessThan(5);
  });

  it('hasMoves is true when some swap makes a match (or a special can be swapped); shuffle always leaves one', () => {
    expect(hasMoves(grid(['01', '10']))).toBe(false); // no line of 3 can form
    expect(hasMoves(grid(['0B', '10']))).toBe(true);
    expect(hasMoves(grid(['1121']))).toBe(true); // swap the last two: 1 1 1 2
    expect(hasMoves(grid(['1111']))).toBe(false); // swapping equal pals changes nothing
    for (let seed = 1; seed < 30; seed++) {
      const g = grid(CHECKER);
      shuffle(g, mulberry32(seed), 5, counter(500));
      expect(hasMoves(g)).toBe(true);
    }
  });

  it('largestGroup finds the biggest tappable group for the idle hint', () => {
    const g = grid(['0012', '3333', '1210']);
    expect(key(largestGroup(g))).toEqual(['1,0', '1,1', '1,2', '1,3']);
    expect(largestGroup(grid(CHECKER))).toEqual([]);
  });

  it('buildBoard follows the level layout: holes, sand and ice where the map says', () => {
    const def: LevelDef = {
      n: 1, moves: 20, colors: 4, goals: [{ t: 'sand' }],
      layout: ['x.....x', '.......', '.......', '...i...', '.......', '.......', 'sssssss', 'x.....x'],
    };
    const g = buildBoard(def, mulberry32(7), counter());
    const mask = maskOf(def);
    expect(mask[0]![0]).toBe(false);
    expect(at(g, 0, 0)).toBeNull();
    expect(at(g, 6, 3)).toMatchObject({ k: 'sand' });
    expect(at(g, 3, 3)).toMatchObject({ k: 'pal', ice: true });
    expect(hasMoves(g)).toBe(true);
    for (const row of g) for (const cell of row) if (cell?.k === 'pal') expect(cell.c).toBeLessThan(4);
  });
});

describe('tidepool board: goals and stars', () => {
  const def: LevelDef = {
    n: 3, moves: 20, colors: 5,
    goals: [{ t: 'collect', c: 0, n: 10 }, { t: 'collect', c: 2, n: 5 }, { t: 'sand' }, { t: 'ice', n: 2 }],
    layout: ['.......', '.......', '.......', '..ii...', '.......', '.......', 'ss.....', '.......'],
  };
  it('tracks every goal and is met only when all are done', () => {
    const p = newProgress();
    addProgress(p, { collect: { 0: 10, 2: 4 }, sand: 2, ice: 2 });
    expect(goalStatus(def, p).map((g) => [g.t, g.got, g.need, g.done])).toEqual([
      ['collect', 10, 10, true], ['collect', 4, 5, false], ['sand', 2, 2, true], ['ice', 2, 2, true],
    ]);
    expect(goalsMet(def, p)).toBe(false);
    addProgress(p, { collect: { 2: 3 }, sand: 0, ice: 0 });
    expect(goalsMet(def, p)).toBe(true);
    expect(goalStatus(def, p)[1]!.got).toBe(5); // capped at need
  });

  it('stars come from the share of moves left', () => {
    expect(starsFor(0, 20)).toBe(1);
    expect(starsFor(3, 20)).toBe(2);
    expect(starsFor(6, 20)).toBe(3);
  });
});
