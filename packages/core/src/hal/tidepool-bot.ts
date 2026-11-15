// The Hal robot: a deterministic greedy player for one Tidepool level, built on the game's own engine.
// Turn order mirrors games/tidepool-pals/index.html (move, settle, tide turn, settle), and ensureBubbles runs where the
// game runs it (after building the board, after each collapse in settle). No helpers, boosters or continues; `extra`
// plays on after a loss with more moves, exactly as a level with that many more moves would (the scorer's +5 check).
//
// Rescue-aware: a candidate move is valued on the board after its settle (and the tide turn it triggers), played out on
// a copy with a throwaway random stream, so stranded pals reaching the exit count as rescues and pals moving nearer
// the exit count as progress. Refill colours on the copy are guesses; pieces already on the board move exactly.
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
/** Value weights for rescue goals: a rescue is worth a typical rescue's work (levels.js workload: ~7 moves of ~3
 *  clears); each board cell a stranded pal moves nearer the exit, and each crack in a bubble, is a step toward one. */
const RESCUE_BONUS = 60, EXIT_STEP = 12, CRACK = 8;

export type MoveResult = { ok: false } | { ok: true; grid: Grid; counts: Counts; cleared: unknown[]; spawned?: unknown; cracked?: unknown[] };
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

/** Where the board stands when a move is valued: the game state the lookahead needs. */
type Ctx = { def: LevelDef; prog: Progress; before: number; mask: boolean[][]; rock: boolean[][]; phase: Phase; dir: Dir; made: number; movesLeft: number; exit: Dir | null };

function rescueOpen(e: Engine, def: LevelDef, prog: Progress): boolean {
  return e.goalStatus(def, prog).some((g) => g.t === 'rescue' && !g.done);
}

/** Sum over stranded pals of the board cells between each and the exit edge (fewer is nearer). */
function exitDistance(g: Grid, mask: boolean[][], exit: Dir): number {
  const [dr, dc] = board.GRAVITY[exit] as [number, number];
  let d = 0;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r]!.length; c++) {
    if (g[r]![c]?.k !== 'lost') continue;
    for (let y = r + dr, x = c + dc; y >= 0 && y < mask.length && x >= 0 && x < mask[0]!.length; y += dr, x += dc) if (mask[y]![x]) d++;
  }
  return d;
}

/**
 * The move's settle (and the tide turn it triggers) on a copy, as the game would play them: collapse, ensureBubbles,
 * rescueLost until nothing is rescued. Returns the rescues and how much nearer the exit the remaining stranded pals got.
 */
function lookahead(e: Engine, x: Ctx, grid: Grid, prog: Progress): { saved: number; nearer: number } {
  const exit = x.exit!;
  const g = grid.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
  const rng = e.mulberry32(0x7e5c), newId = e.counter(1e9);
  const p = { ...prog, collect: { ...prog.collect } };
  let phase = x.phase, dir = x.dir, saved = 0;
  const start = exitDistance(g, e.activeMask(x.mask, x.rock, phase), exit);
  const settle = (): void => {
    for (let i = 0; i < MAX_CASCADES; i++) {
      e.collapse(g, e.activeMask(x.mask, x.rock, phase), rng, x.def.colors, newId, dir);
      e.ensureBubbles(g, x.def, x.mask, p);
      const s = e.rescueLost(g, e.activeMask(x.mask, x.rock, phase), exit);
      if (!s.length) return;
      saved += s.length;
      e.addProgress(p, { rescue: s.length } as Counts);
    }
  };
  settle();
  const made = x.made + 1;
  if (e.tideTurns(x.def.tide, made) && !e.goalsMet(x.def, p) && x.movesLeft - 1 > 0) {
    const tp = e.tidePhase(x.def.tide, made);
    phase = tp.phase; dir = tp.dir;
    e.turnTide(g, x.mask, x.rock, phase, dir, rng, x.def.colors, newId);
    settle();
  }
  return { saved, nearer: start - exitDistance(g, e.activeMask(x.mask, x.rock, phase), exit) };
}

function value(e: Engine, x: Ctx, res: MoveResult): number {
  if (!res.ok) return -Infinity;
  const trial = e.addProgress({ ...x.prog, collect: { ...x.prog.collect } }, res.counts);
  let v = res.cleared.length + (res.spawned ? 3 : 0);
  if (rescueOpen(e, x.def, x.prog)) {
    v += RESCUE_BONUS * (res.counts.rescue ?? 0) + CRACK * (res.cracked?.length ?? 0);
    if (x.exit) {
      const { saved, nearer } = lookahead(e, x, res.grid, trial);
      if (saved) e.addProgress(trial, { rescue: saved } as Counts);
      v += RESCUE_BONUS * saved + EXIT_STEP * nearer;
    }
  }
  return v + 10 * (goalSum(e, x.def, trial) - x.before);
}

/** Pick the best tap: one cell per distinct group, plus every special, valued by goal progress then size. */
function chooseTap(e: Engine, x: Ctx, grid: Grid, newId: () => number): Move | null {
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
      const v = value(e, x, e.resolveTap(grid, r, c, newId));
      if (v > bestValue) { bestValue = v; best = { r, c }; }
    }
  }
  return best;
}

/** Pick the best swap: every right and down neighbour pair, valued the same way. */
function chooseSwap(e: Engine & SwapFns, x: Ctx, grid: Grid, newId: () => number): Move | null {
  let best: Move | null = null;
  let bestValue = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      if (!grid[r]![c]) continue;
      for (const [r2, c2] of [[r, c + 1], [r + 1, c]] as const) {
        if (!grid[r2]?.[c2]) continue;
        const v = value(e, x, e.resolveSwap(grid, r, c, r2, c2, newId));
        if (v > bestValue) { bestValue = v; best = { r, c, r2, c2 }; }
      }
    }
  }
  return best;
}

/** A play, plus with `extra`: whether the loss would have been won with that many more moves. */
export type TidepoolPlay = PlayResult & { wonWithExtra?: boolean };

export function playLevel(def: LevelDef, seed: number, e: Engine = board, opts: { extra?: number } = {}): TidepoolPlay {
  const extra = opts.extra ?? 0;
  const kind = moveKind(e);
  const swap = e as Engine & SwapFns;
  const rng = e.mulberry32(e.hashSeed(`${def.n}:${seed}`));
  const newId = e.counter();
  let grid = e.buildBoard(def, rng, newId, 'high');
  const mask = e.maskOf(def);
  const rock = e.rockOf(def);
  const prog0 = e.newProgress();
  e.ensureBubbles(grid, def, mask, prog0);
  let phase: Phase = 'high';
  let dir: Dir = 'down';
  const prog = prog0;
  let moves = def.moves;
  let made = 0;
  let shuffles = 0;
  let turns = 0;
  let rescued = 0;
  const exit = def.exit ?? null;

  const settle = (): void => {
    for (let i = 0; i < MAX_CASCADES; i++) {
      e.collapse(grid, e.activeMask(mask, rock, phase), rng, def.colors, newId, dir);
      e.ensureBubbles(grid, def, mask, prog);
      const saved = e.rescueLost(grid, e.activeMask(mask, rock, phase), exit);
      if (saved.length) { e.addProgress(prog, { rescue: saved.length }); rescued += saved.length; }
      const m = kind === 'swap' ? swap.resolveMatches(grid, newId) : { ok: false as const };
      if (m.ok) { grid = m.grid; e.addProgress(prog, m.counts); continue; }
      if (saved.length === 0) return;
    }
  };

  const tideTurn = (): void => {
    const tp = e.tidePhase(def.tide, made);
    phase = tp.phase;
    dir = tp.dir;
    turns++;
    const t = e.turnTide(grid, mask, rock, phase, dir, rng, def.colors, newId);
    e.addProgress(prog, t.counts);
    settle();
  };

  /** Plays until the goals are met or the moves run out; false when play stopped early (no move, shuffle cap). */
  const play = (): boolean => {
    while (moves > 0 && !e.goalsMet(def, prog)) {
      if (!e.hasMoves(grid)) {
        if (shuffles >= MAX_SHUFFLES) return false;
        e.shuffle(grid, rng, def.colors, newId);
        shuffles++;
        continue;
      }
      const x: Ctx = { def, prog, before: goalSum(e, def, prog), mask, rock, phase, dir, made, movesLeft: moves, exit };
      const mv = kind === 'swap' ? chooseSwap(swap, x, grid, newId) : chooseTap(e, x, grid, newId);
      if (!mv) return false;
      const res: MoveResult = mv.r2 === undefined || mv.c2 === undefined
        ? e.resolveTap(grid, mv.r, mv.c, newId)
        : swap.resolveSwap(grid, mv.r, mv.c, mv.r2, mv.c2, newId);
      if (!res.ok) return false;
      moves--;
      made++;
      grid = res.grid;
      e.addProgress(prog, res.counts);
      settle();
      if (e.tideTurns(def.tide, made) && !e.goalsMet(def, prog) && moves > 0) tideTurn();
    }
    return true;
  };

  const ranOut = play();
  const won = e.goalsMet(def, prog);
  const result = finish(won);
  if (extra > 0) {
    let wonWithExtra = won;
    if (!won && ranOut) {
      // A level with `extra` more moves plays exactly this far, then turns the tide this last move skipped (it only
      // turns while moves are left) and plays on.
      moves = extra;
      if (e.tideTurns(def.tide, made)) tideTurn();
      play();
      wonWithExtra = e.goalsMet(def, prog);
    }
    return { ...result, wonWithExtra };
  }
  return result;

  function finish(won: boolean): PlayResult {
    const goals = e.goalStatus(def, prog);
    const goalFrac = goals.length === 0 ? 1
      : goals.reduce((a, g) => a + (g.need > 0 ? Math.min(g.got, g.need) / g.need : 1), 0) / goals.length;
    return {
      won, movesUsed: def.moves - moves, movesLeft: moves, stars: won ? e.starsFor(moves, def.moves) : 0,
      shuffles, tideTurns: turns, rescued, goalFrac,
    };
  }
}
