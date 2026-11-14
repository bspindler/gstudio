// The Hal robot: a deterministic greedy player for one Tidepool level, built on the game's own engine.
// Turn order mirrors games/tidepool-pals/index.html (move, settle, tide turn, settle). No helpers, boosters or continues.
//
// The robot plays whichever move the game's board.js says it has (Brian, 2026-11-14, so the game can move to swaps):
//   tap  (default, no MOVE export): resolveTap(grid, r, c, newId) on a group or a special.
//   swap (`export const MOVE = 'swap'`): every move swaps two orthogonal neighbours. board.js must then export
//     resolveSwap(grid, r1, c1, r2, c2, newId): { ok: false } when the swap makes no match (no move is spent),
//       otherwise the same result shape as resolveTap (grid, counts, cleared, spawned...) for the swap's own clear;
//     resolveMatches(grid, newId): { ok: false } when the board has no match, otherwise the same shape for clearing
//       every match on it. The robot calls it after each collapse, so cascades count toward the goals;
//     hasMoves(grid): true when some swap makes a match (shuffle runs when it is false).
//   A swap game missing either function is an error, never a silent tap game.
import * as board from '../../../../games/tidepool-pals/board.js';
import type { Counts, Dir, Grid, LevelDef, Phase, Progress } from '../../../../games/tidepool-pals/board.js';
import type { PlayResult } from './types.js';

const MAX_SHUFFLES = 50;
/** Settling a board that keeps matching forever is a broken engine; stop rather than hang. */
const MAX_CASCADES = 200;

export type MoveResult = { ok: false } | { ok: true; grid: Grid; counts: Counts; cleared: unknown[]; spawned?: unknown };
export type SwapFns = {
  resolveSwap(g: Grid, r1: number, c1: number, r2: number, c2: number, newId: () => number): MoveResult;
  resolveMatches(g: Grid, newId: () => number): MoveResult;
};
/** board.js as the robot sees it: the tap engine, plus the swap contract when MOVE is 'swap'. */
export type Engine = typeof board & { MOVE?: string } & Partial<SwapFns>;
type Move = { r: number; c: number; r2?: number; c2?: number };

export function moveKind(e: Engine): 'tap' | 'swap' {
  if (e.MOVE === undefined || e.MOVE === 'tap') return 'tap';
  if (e.MOVE !== 'swap') throw new Error(`tidepool board.js: MOVE must be 'tap' or 'swap', got ${JSON.stringify(e.MOVE)}`);
  const missing = (['resolveSwap', 'resolveMatches'] as const).filter((f) => typeof e[f] !== 'function');
  if (missing.length) throw new Error(`tidepool board.js: MOVE is 'swap' but it does not export ${missing.join(' and ')}`);
  return 'swap';
}

/** Sum over goals of min(got, need): the robot's measure of progress. */
function goalSum(e: Engine, def: LevelDef, prog: Progress): number {
  return e.goalStatus(def, prog).reduce((a, g) => a + Math.min(g.got, g.need), 0);
}

function value(e: Engine, def: LevelDef, prog: Progress, before: number, res: MoveResult): number {
  if (!res.ok) return -Infinity;
  const trial = e.addProgress({ ...prog, collect: { ...prog.collect } }, res.counts);
  return 10 * (goalSum(e, def, trial) - before) + res.cleared.length + (res.spawned ? 3 : 0);
}

/** Pick the best tap: one cell per distinct group, plus every special, valued by goal progress then size. */
function chooseTap(e: Engine, def: LevelDef, grid: Grid, prog: Progress, newId: () => number): Move | null {
  const before = goalSum(e, def, prog);
  const seen = new Set<string>();
  let best: Move | null = null;
  let bestValue = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      const cell = grid[r]![c];
      if (!cell) continue;
      if (cell.k === 'sp') { /* every special is a candidate */ } else {
        if (cell.k !== 'pal' || seen.has(`${r},${c}`)) continue;
        const cells = e.group(grid, r, c);
        for (const [gr, gc] of cells) seen.add(`${gr},${gc}`);
        if (cells.length < 2) continue;
      }
      const v = value(e, def, prog, before, e.resolveTap(grid, r, c, newId));
      if (v > bestValue) { bestValue = v; best = { r, c }; }
    }
  }
  return best;
}

/** Pick the best swap: every right and down neighbour pair, valued the same way. */
function chooseSwap(e: Engine & SwapFns, def: LevelDef, grid: Grid, prog: Progress, newId: () => number): Move | null {
  const before = goalSum(e, def, prog);
  let best: Move | null = null;
  let bestValue = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      if (!grid[r]![c]) continue;
      for (const [r2, c2] of [[r, c + 1], [r + 1, c]] as const) {
        if (!grid[r2]?.[c2]) continue;
        const v = value(e, def, prog, before, e.resolveSwap(grid, r, c, r2, c2, newId));
        if (v > bestValue) { bestValue = v; best = { r, c, r2, c2 }; }
      }
    }
  }
  return best;
}

export function playLevel(def: LevelDef, seed: number, e: Engine = board): PlayResult {
  const kind = moveKind(e);
  const swap = e as Engine & SwapFns;
  const rng = e.mulberry32(e.hashSeed(`${def.n}:${seed}`));
  const newId = e.counter();
  let grid = e.buildBoard(def, rng, newId, 'high');
  const mask = e.maskOf(def);
  const rock = e.rockOf(def);
  let phase: Phase = 'high';
  let dir: Dir = 'down';
  const prog = e.newProgress();
  let moves = def.moves;
  let made = 0;
  let shuffles = 0;
  let turns = 0;
  let rescued = 0;
  const exit = def.exit ?? null;

  const settle = (): void => {
    for (let i = 0; i < MAX_CASCADES; i++) {
      e.collapse(grid, e.activeMask(mask, rock, phase), rng, def.colors, newId, dir);
      const saved = e.rescueLost(grid, e.activeMask(mask, rock, phase), exit);
      if (saved.length) { e.addProgress(prog, { rescue: saved.length }); rescued += saved.length; }
      const m = kind === 'swap' ? swap.resolveMatches(grid, newId) : { ok: false as const };
      if (m.ok) { grid = m.grid; e.addProgress(prog, m.counts); continue; }
      if (saved.length === 0) return;
    }
  };

  while (moves > 0 && !e.goalsMet(def, prog)) {
    if (!e.hasMoves(grid)) {
      if (shuffles >= MAX_SHUFFLES) break;
      e.shuffle(grid, rng, def.colors, newId);
      shuffles++;
      continue;
    }
    const mv = kind === 'swap' ? chooseSwap(swap, def, grid, prog, newId) : chooseTap(e, def, grid, prog, newId);
    if (!mv) break;
    const res: MoveResult = mv.r2 === undefined || mv.c2 === undefined
      ? e.resolveTap(grid, mv.r, mv.c, newId)
      : swap.resolveSwap(grid, mv.r, mv.c, mv.r2, mv.c2, newId);
    if (!res.ok) break;
    moves--;
    made++;
    grid = res.grid;
    e.addProgress(prog, res.counts);
    settle();
    if (e.tideTurns(def.tide, made) && !e.goalsMet(def, prog) && moves > 0) {
      const tp = e.tidePhase(def.tide, made);
      phase = tp.phase;
      dir = tp.dir;
      turns++;
      const t = e.turnTide(grid, mask, rock, phase, dir, rng, def.colors, newId);
      e.addProgress(prog, t.counts);
      settle();
    }
  }

  const won = e.goalsMet(def, prog);
  const goals = e.goalStatus(def, prog);
  const goalFrac = goals.length === 0 ? 1
    : goals.reduce((a, g) => a + (g.need > 0 ? Math.min(g.got, g.need) / g.need : 1), 0) / goals.length;
  return {
    won, movesUsed: def.moves - moves, movesLeft: moves, stars: won ? e.starsFor(moves, def.moves) : 0,
    shuffles, tideTurns: turns, rescued, goalFrac,
  };
}
