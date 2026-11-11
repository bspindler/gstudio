// The Hal robot: a deterministic greedy player for one Tidepool level, built on the game's own engine.
// Turn order mirrors games/tidepool-pals/index.html (tap, settle, tide turn, settle). No helpers, boosters or continues.
import {
  activeMask, addProgress, buildBoard, collapse, counter, goalStatus, goalsMet, group, hasMoves, hashSeed, maskOf,
  mulberry32, newProgress, rescueLost, resolveTap, rockOf, shuffle, starsFor, tidePhase, tideTurns, turnTide,
  type Dir, type Grid, type LevelDef, type Phase, type Progress,
} from '../../../../games/tidepool-pals/board.js';
import type { PlayResult } from './types.js';

const MAX_SHUFFLES = 50;

/** Sum over goals of min(got, need): the robot's measure of progress. */
function goalSum(def: LevelDef, prog: Progress): number {
  return goalStatus(def, prog).reduce((a, g) => a + Math.min(g.got, g.need), 0);
}

/** Pick the best tap: one cell per distinct group, plus every special, valued by goal progress then size. */
function choose(def: LevelDef, grid: Grid, prog: Progress, newId: () => number): { r: number; c: number } | null {
  const before = goalSum(def, prog);
  const seen = new Set<string>();
  let best: { r: number; c: number } | null = null;
  let bestValue = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      const cell = grid[r]![c];
      if (!cell) continue;
      if (cell.k === 'sp') { /* every special is a candidate */ } else {
        if (cell.k !== 'pal' || seen.has(`${r},${c}`)) continue;
        const cells = group(grid, r, c);
        for (const [gr, gc] of cells) seen.add(`${gr},${gc}`);
        if (cells.length < 2) continue;
      }
      const res = resolveTap(grid, r, c, newId);
      if (!res.ok) continue;
      const trial = addProgress({ ...prog, collect: { ...prog.collect } }, res.counts);
      const value = 10 * (goalSum(def, trial) - before) + res.cleared.length + (res.spawned ? 3 : 0);
      if (value > bestValue) { bestValue = value; best = { r, c }; }
    }
  }
  return best;
}

export function playLevel(def: LevelDef, seed: number): PlayResult {
  const rng = mulberry32(hashSeed(`${def.n}:${seed}`));
  const newId = counter();
  let grid = buildBoard(def, rng, newId, 'high');
  const mask = maskOf(def);
  const rock = rockOf(def);
  let phase: Phase = 'high';
  let dir: Dir = 'down';
  const prog = newProgress();
  let moves = def.moves;
  let made = 0;
  let shuffles = 0;
  let turns = 0;
  let rescued = 0;
  const exit = def.exit ?? null;

  const settle = (): void => {
    for (;;) {
      collapse(grid, activeMask(mask, rock, phase), rng, def.colors, newId, dir);
      const saved = rescueLost(grid, activeMask(mask, rock, phase), exit);
      if (saved.length === 0) return;
      addProgress(prog, { rescue: saved.length });
      rescued += saved.length;
    }
  };

  while (moves > 0 && !goalsMet(def, prog)) {
    if (!hasMoves(grid)) {
      if (shuffles >= MAX_SHUFFLES) break;
      shuffle(grid, rng, def.colors, newId);
      shuffles++;
      continue;
    }
    const tap = choose(def, grid, prog, newId);
    if (!tap) break;
    const res = resolveTap(grid, tap.r, tap.c, newId);
    if (!res.ok) break;
    moves--;
    made++;
    grid = res.grid;
    addProgress(prog, res.counts);
    settle();
    if (tideTurns(def.tide, made) && !goalsMet(def, prog) && moves > 0) {
      const tp = tidePhase(def.tide, made);
      phase = tp.phase;
      dir = tp.dir;
      turns++;
      const t = turnTide(grid, mask, rock, phase, dir, rng, def.colors, newId);
      addProgress(prog, t.counts);
      settle();
    }
  }

  const won = goalsMet(def, prog);
  const goals = goalStatus(def, prog);
  const goalFrac = goals.length === 0 ? 1
    : goals.reduce((a, g) => a + (g.need > 0 ? Math.min(g.got, g.need) / g.need : 1), 0) / goals.length;
  return {
    won, movesUsed: def.moves - moves, movesLeft: moves, stars: won ? starsFor(moves, def.moves) : 0,
    shuffles, tideTurns: turns, rescued, goalFrac,
  };
}
