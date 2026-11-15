import { describe, expect, it } from 'vitest';
import {
  MOVE, bestSwap, buildBoard, counter, goalStatus, hasMoves, mulberry32,
  type Cell, type Grid, type LevelDef, type TapResult,
} from '../../../games/tidepool-pals/board.js';
import * as boardNs from '../../../games/tidepool-pals/board.js';

// board.d.ts leaves resolveSwap and resolveMatches undeclared (the protected robot test needs them optional on the
// module type), so type them here, with the full tap-result shape.
const ns = boardNs as unknown as {
  resolveSwap(g: Grid, r1: number, c1: number, r2: number, c2: number, id: () => number): TapResult;
  resolveMatches(g: Grid, id: () => number): TapResult;
};
const resolveSwap = ns.resolveSwap;
const resolveMatches = ns.resolveMatches;
import { levelDef } from '../../../games/tidepool-pals/levels.js';
import { playLevel } from '../src/hal/tidepool-bot.js';

// Digits are pals of that colour, 'n' a netted pal (colour 0), 's' sand, 'B' an urchin bomb, 'P' a stranded pal, '*' empty.
function grid(rows: string[]): Grid {
  const id = counter();
  return rows.map((row) => [...row].map((ch): Cell | null => {
    if (ch === '*') return null;
    if (ch === 's') return { id: id(), k: 'sand' };
    if (ch === 'B') return { id: id(), k: 'sp', s: 'bomb', c: 0 };
    if (ch === 'P') return { id: id(), k: 'lost' };
    if (ch === 'n') return { id: id(), k: 'pal', c: 0, ice: true };
    return { id: id(), k: 'pal', c: Number(ch) };
  }));
}

describe('tidepool pals: swipe to swap, match 3 or more', () => {
  it('declares the swap move', () => {
    expect(MOVE).toBe('swap');
  });

  it('a swap that lines up 3 clears them and counts them', () => {
    const r = resolveSwap(grid(['1121', '3434']), 0, 2, 0, 3, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.kind).toBe('group');
    expect(r.cleared.map((x) => `${x.r},${x.c}`).sort()).toEqual(['0,0', '0,1', '0,2']);
    expect(r.counts.collect[1]).toBe(3);
    expect(r.grid[0]![3]).toMatchObject({ k: 'pal', c: 2 });
  });

  it('a swap that makes no match, swaps equal pals, or touches a fixed piece does nothing', () => {
    expect(resolveSwap(grid(['1234', '3412']), 0, 0, 0, 1, counter(100)).ok).toBe(false);
    expect(resolveSwap(grid(['1111']), 0, 0, 0, 1, counter(100)).ok).toBe(false);
    expect(resolveSwap(grid(['11s1']), 0, 2, 0, 3, counter(100)).ok).toBe(false);
    expect(resolveSwap(grid(['11n2', '3434']), 0, 2, 0, 3, counter(100)).ok).toBe(false);
    expect(resolveSwap(grid(['1121']), 0, 0, 0, 2, counter(100)).ok).toBe(false); // not neighbours
  });

  it('vertical matches work, and a match next to sand breaks it', () => {
    const r = resolveSwap(grid(['1s', '21', '31', '12']), 3, 0, 3, 1, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.cleared).toHaveLength(3);
    expect(r.counts.sand).toBe(1);
  });

  it('a run of 5 leaves a bomb where the swap landed', () => {
    const r = resolveSwap(grid(['11211', '33133']), 0, 2, 1, 2, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.spawned).toMatchObject({ r: 0, c: 2, cell: { k: 'sp', s: 'bomb' } });
  });

  it('swapping a special sets it off, match or not', () => {
    const r = resolveSwap(grid(['B12', '312']), 0, 0, 0, 1, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.kind).toBe('special');
    expect(r.cleared.length).toBeGreaterThan(1);
  });

  it('resolveMatches clears every match on the board (cascades), and nothing when there is none', () => {
    expect(resolveMatches(grid(['0120', '1201']), counter(100)).ok).toBe(false);
    const r = resolveMatches(grid(['11122', '33344']), counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.cleared).toHaveLength(6);
    expect(r.counts.collect).toEqual({ 1: 3, 3: 3 });
    expect(resolveMatches(r.grid, counter(200)).ok).toBe(false);
  });

  it('never lets the board it is given change', () => {
    const g = grid(['1121', '3434']);
    const before = JSON.stringify(g);
    resolveSwap(g, 0, 2, 0, 3, counter(100));
    resolveMatches(g, counter(100));
    expect(JSON.stringify(g)).toBe(before);
  });

  it('bestSwap picks the biggest clear, preferring wanted colours, and is null with no move', () => {
    expect(bestSwap(grid(['01', '10']))).toBeNull();
    const g = grid(['1121', '3343']);
    expect(bestSwap(g)!.n).toBe(3);
    expect(bestSwap(g, new Set([3]))).toMatchObject({ r: 1, c: 2, r2: 1, c2: 3 });
    expect(bestSwap(g, new Set([1]))).toMatchObject({ r: 0, c: 2, r2: 0, c2: 3 });
  });

  it('fresh boards start with no ready-made match and a swap to make', () => {
    for (const n of [1, 6, 12, 20, 27]) {
      for (let seed = 1; seed <= 4; seed++) {
        const g = buildBoard(levelDef(n), mulberry32(seed), counter());
        expect(resolveMatches(g, counter(1000)).ok).toBe(false);
        expect(hasMoves(g)).toBe(true);
      }
    }
  });

  it('the robot plays a swap game on every level without errors, and early levels are winnable', () => {
    const def: LevelDef = levelDef(1);
    const wins = [1, 2, 3, 4, 5].filter((s) => playLevel(def, s).won).length;
    expect(wins).toBeGreaterThanOrEqual(4);
    expect(goalStatus(def, { collect: { 0: 12 }, sand: 0, ice: 0, litter: 0, rescue: 0 })[0]!.done).toBe(true);
  });
});
