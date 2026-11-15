// The robot plays whichever move the game's board.js exposes. A swap game exports MOVE = 'swap', resolveSwap and
// resolveMatches (the contract in src/hal/tidepool-bot.ts). This file drives the robot with a small reference swap
// engine built on the real board.js, so the swap path is tested before the game ever ships swaps.
import { describe, expect, it } from 'vitest';

import * as board from '../../../games/tidepool-pals/board.js';
import type { Counts, Grid } from '../../../games/tidepool-pals/board.js';
import { levelDef } from '../../../games/tidepool-pals/levels.js';
import { moveKind, playLevel, type Engine, type MoveResult } from '../src/hal/tidepool-bot.js';

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const free = (g: Grid, r: number, c: number) => { const x = g[r]?.[c]; return x && x.k === 'pal' && !x.ice ? x : null; };

/** Clears every horizontal or vertical line of 3+ free pals of one colour. */
function resolveMatches(src: Grid): MoveResult {
  const hit = new Set<string>();
  for (let r = 0; r < src.length; r++) for (let c = 0; c < src[r]!.length; c++) {
    const p = free(src, r, c);
    if (!p) continue;
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      let n = 1;
      while (free(src, r + dr * n, c + dc * n)?.c === p.c) n++;
      if (n >= 3) for (let i = 0; i < n; i++) hit.add(`${r + dr * i},${c + dc * i}`);
    }
  }
  if (hit.size === 0) return { ok: false };
  const grid = src.map((row) => [...row]);
  const counts: Counts = { collect: {}, sand: 0, ice: 0, litter: 0 };
  const cleared = [...hit].map((k) => {
    const [r, c] = k.split(',').map(Number) as [number, number];
    const cell = grid[r]![c]!;
    if (cell.k === 'pal') counts.collect[cell.c] = (counts.collect[cell.c] ?? 0) + 1;
    grid[r]![c] = null;
    return { r, c, cell };
  });
  return { ok: true, grid, counts, cleared };
}

function resolveSwap(src: Grid, r1: number, c1: number, r2: number, c2: number): MoveResult {
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1 || !free(src, r1, c1) || !free(src, r2, c2)) return { ok: false };
  const g = src.map((row) => [...row]);
  [g[r1]![c1], g[r2]![c2]] = [g[r2]![c2]!, g[r1]![c1]!];
  return resolveMatches(g);
}

function hasMoves(g: Grid): boolean {
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r]!.length; c++) {
    if (resolveSwap(g, r, c, r, c + 1).ok || resolveSwap(g, r, c, r + 1, c).ok) return true;
  }
  return false;
}

let swaps = 0;
const swapEngine: Engine = {
  ...board, MOVE: 'swap', hasMoves,
  resolveSwap: (g, r1, c1, r2, c2) => { swaps++; return resolveSwap(g, r1, c1, r2, c2); },
  resolveMatches: (g) => resolveMatches(g),
  resolveTap: () => { throw new Error('a swap game is never tapped'); },
};

describe('tidepool robot: move kind', () => {
  // Follows the real board.js, so the game can move to swaps without editing this protected file. moveKind throws
  // when a game declares swaps but lacks resolveSwap or resolveMatches, so a half-built swap game fails here.
  it('the game as it is today plays the move its board.js declares', () => {
    const declared = (board as Engine).MOVE === 'swap' ? 'swap' : 'tap';
    expect(moveKind(board)).toBe(declared);
  });

  it('MOVE = swap with resolveSwap and resolveMatches plays swaps', () => {
    expect(moveKind(swapEngine)).toBe('swap');
  });

  it('MOVE = swap without the swap functions is a clear error, not a silent tap game', () => {
    const { resolveMatches: _m, ...noMatches } = swapEngine;
    expect(() => moveKind(noMatches)).toThrow(/resolveMatches/);
    const { resolveSwap: _s, ...noSwap } = swapEngine;
    expect(() => moveKind(noSwap)).toThrow(/resolveSwap/);
  });

  it('an unknown MOVE is an error', () => {
    expect(() => moveKind({ ...board, MOVE: 'drag' } as unknown as Engine)).toThrow(/MOVE/);
  });
});

describe('tidepool robot: swap game', () => {
  it('plays swaps, never taps, and is deterministic', () => {
    swaps = 0;
    const a = playLevel(levelDef(1), 7, swapEngine);
    expect(swaps).toBeGreaterThan(0);
    expect(a.movesUsed).toBeGreaterThan(0);
    expect(playLevel(levelDef(1), 7, swapEngine)).toEqual(a);
  });

  it('wins some early levels and spends moves honestly', () => {
    const results = [1, 2].flatMap((n) => seeds(10).map((s) => ({ n, r: playLevel(levelDef(n), s, swapEngine) })));
    expect(results.some(({ r }) => r.won)).toBe(true);
    for (const { n, r } of results) expect(r.movesLeft).toBe(levelDef(n).moves - r.movesUsed);
  });
});
