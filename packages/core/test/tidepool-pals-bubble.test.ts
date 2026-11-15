import { describe, expect, it } from 'vitest';
import {
  addProgress, buildBoard, collapse, counter, ensureBubbles, goalStatus, isFixed, maskOf, mulberry32, newProgress, resolveTap,
  type Grid,
} from '../../../games/tidepool-pals/board.js';
import { levelDef, validateLevel } from '../../../games/tidepool-pals/levels.js';

// Two coral pals side by side at the left, a bubble pal next to them.
function board(): Grid {
  const id = counter(1);
  const g: Grid = Array.from({ length: 3 }, (_, r) => Array.from({ length: 4 }, (_, c) => ({ id: id(), k: 'pal' as const, c: (r + c * 2) % 4 === 0 ? 1 : (r * 3 + c) % 4 === 1 ? 2 : 3 })));
  g[1]![1] = { id: id(), k: 'bubble', hp: 2 };
  g[0]![0] = { id: id(), k: 'pal', c: 0 };
  g[0]![1] = { id: id(), k: 'pal', c: 0 };
  return g;
}

describe('tidepool pals: pal trapped in a bubble', () => {
  it('level 9 holds a bubble pal and rescuing it is a goal', () => {
    const def = levelDef(9);
    expect(validateLevel(def)).toEqual([]);
    const g = buildBoard(def, mulberry32(3), counter(1));
    expect(g[4]![3]).toMatchObject({ k: 'bubble', hp: 2 });
    expect(goalStatus(def, newProgress())[0]).toMatchObject({ t: 'rescue', need: 1, got: 0, done: false });
  });

  it('level 3 teaches it early: one bubble pal, a rescue goal, tide kept', () => {
    const def = levelDef(3);
    expect(validateLevel(def)).toEqual([]);
    expect(def.layout.join('').split('B')).toHaveLength(2);
    expect(def.goals[0]).toMatchObject({ t: 'rescue', n: 1 });
    expect(def.tide).toBeTruthy();
    expect(def.intro).toMatch(/bubble/i);
  });

  it('is fixed and cannot be tapped', () => {
    const g = board();
    expect(isFixed(g[1]![1]!)).toBe(true);
    expect(resolveTap(g, 1, 1, counter(100)).ok).toBe(false);
  });

  it('a clear next to it cracks the bubble, the next one frees the pal and counts as a rescue', () => {
    const g = board();
    const r1 = resolveTap(g, 0, 0, counter(100));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.cracked).toHaveLength(1);
    expect(r1.released).toHaveLength(0);
    expect(r1.grid[1]![1]).toMatchObject({ k: 'bubble', hp: 1 });
    expect(g[1]![1]).toMatchObject({ k: 'bubble', hp: 2 }); // source grid untouched

    // set up another clear beside the cracked bubble
    const g2 = r1.grid;
    g2[1]![0] = { id: 900, k: 'pal', c: 2 };
    g2[2]![0] = { id: 901, k: 'pal', c: 2 };
    const r2 = resolveTap(g2, 1, 0, counter(1000));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.released).toHaveLength(1);
    expect(r2.grid[1]![1]).toBeNull();
    expect(r2.counts.rescue).toBe(1);
    const p = addProgress(newProgress(), r2.counts);
    expect(goalStatus(levelDef(9), p)[0]).toMatchObject({ got: 1, done: true });
  });

  it('safety net: level 9 always has a freeable bubble while the rescue goal is open', () => {
    const def = levelDef(9), mask = maskOf(def);
    const g = buildBoard(def, mulberry32(3), counter(1));
    // present at the start: nothing is added
    expect(ensureBubbles(g, def, mask, newProgress())).toEqual([]);
    // missing (lost in a collapse): placed again at its home cell, ready to crack
    g[4]![3] = { id: 999, k: 'pal', c: 1 };
    const placed = ensureBubbles(g, def, mask, newProgress());
    expect(placed).toHaveLength(1);
    expect(g[4]![3]).toMatchObject({ k: 'bubble', hp: 2 });
    // a taken cell falls back to the nearest free pal
    g[4]![3] = { id: 998, k: 'sand' };
    expect(ensureBubbles(g, def, mask, newProgress())).toHaveLength(1);
    expect(g.flat().filter((x) => x?.k === 'bubble')).toHaveLength(1);
    // once the pal is rescued, no new bubble appears
    const empty = buildBoard(def, mulberry32(4), counter(1));
    empty[4]![3] = { id: 997, k: 'pal', c: 2 };
    const done = addProgress(newProgress(), { rescue: 1 });
    expect(ensureBubbles(empty, def, mask, done)).toEqual([]);
  });

  it('stays put when the pieces around it fall', () => {
    const g = board();
    const mask = g.map((row) => row.map(() => true));
    g[2]![1] = null;
    collapse(g, mask, mulberry32(1), 4, counter(500), 'down');
    expect(g[1]![1]).toMatchObject({ k: 'bubble' });
    expect(maskOf(levelDef(9))[4]![3]).toBe(true);
  });
});
