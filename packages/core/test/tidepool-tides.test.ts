import { describe, expect, it } from 'vitest';

import {
  ABILITIES, COLS, GRAVITY, ROWS, activeMask, addProgress, applyAbility, atExit, buildBoard, collapse, counter,
  doubleCounts, goalStatus, goalsMet, helperCharge, mulberry32, newProgress, rescueLost, resolveTap, rockOf, tidePhase,
  tideTurns, turnTide, washOut, type Cell, type Dir, type Grid, type LevelDef, type Mask,
} from '../../../games/tidepool-pals/board.js';

// Grid helper: digits are pals of that colour, 's' sand, 'l' litter, 'n' a netted pal (colour 0), 'P' a stranded
// pal, 'B' bomb, 'H' row wave (colour 0), 'x' hole, '*' empty.
function grid(rows: string[]): Grid {
  const id = counter();
  return rows.map((row) => [...row].map((ch): Cell | null => {
    if (ch === 'x' || ch === '*') return null;
    if (ch === 's') return { id: id(), k: 'sand' };
    if (ch === 'l') return { id: id(), k: 'litter', v: 0 };
    if (ch === 'n') return { id: id(), k: 'pal', c: 0, ice: true };
    if (ch === 'P') return { id: id(), k: 'lost' };
    if (ch === 'B') return { id: id(), k: 'sp', s: 'bomb', c: 0 };
    if (ch === 'H') return { id: id(), k: 'sp', s: 'wave-h', c: 0 };
    return { id: id(), k: 'pal', c: Number(ch) };
  }));
}
const maskFrom = (rows: string[]): Mask => rows.map((row) => [...row].map((ch) => ch !== 'x'));
const show = (g: Grid) => g.map((row) => row.map((c) => {
  if (!c) return '*';
  if (c.k === 'pal') return c.ice ? 'n' : 'p';
  return { sand: 's', litter: 'l', lost: 'P', sp: 'B' }[c.k];
}).join(''));
const at = (g: Grid, r: number, c: number) => g[r]![c];
const CHECKER = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => String(((r + c) % 2) + 1)).join(''));
const put = (rows: string[], r: number, c: number, ch: string) =>
  rows.map((row, i) => (i === r ? row.slice(0, c) + ch + row.slice(c + 1) : row));

describe('tidepool gravity in all four directions', () => {
  // One gap in the middle of a 3x3; the piece that was at the far edge moves into it, a new one enters.
  const cases: [Dir, string[], string[]][] = [
    ['down', ['1P1', '1*1', '111'], ['1p1', '1P1', '111']],
    ['up', ['111', '1*1', '1P1'], ['111', '1P1', '1p1']],
    ['left', ['111', '*1P', '111'], ['111', '1Pp', '111']],
    ['right', ['111', 'P1*', '111'], ['111', 'pP1', '111']],
  ];
  it.each(cases)('gravity %s packs pieces toward that side and refills from the opposite edge', (dir, before, after) => {
    const g = grid(before);
    const { spawned } = collapse(g, maskFrom(before), mulberry32(1), 4, counter(100), dir);
    expect(show(g)).toEqual(after.map((row) => row.replace(/[0-9]/g, 'p')));
    expect(spawned).toHaveLength(1);
    // the new piece slides in from one step outside the entry edge
    const [dr, dc] = GRAVITY[dir];
    const s = spawned[0]!;
    expect([s.fromR, s.fromC]).toEqual([s.r - dr, s.c - dc]);
    expect(s.fromR < 0 || s.fromR >= 3 || s.fromC < 0 || s.fromC >= 3).toBe(true);
  });

  it.each(['down', 'up', 'left', 'right'] as Dir[])('gravity %s: sand, litter and nets stay fixed and split the line', (dir) => {
    // a plus of fixed cells round an empty centre line; nothing fixed may move
    const rows = ['1s1', 'l*n', '1s1'];
    const g = grid(rows);
    collapse(g, maskFrom(rows), mulberry32(2), 4, counter(100), dir);
    expect(at(g, 0, 1)).toMatchObject({ k: 'sand' });
    expect(at(g, 2, 1)).toMatchObject({ k: 'sand' });
    expect(at(g, 1, 0)).toMatchObject({ k: 'litter' });
    expect(at(g, 1, 2)).toMatchObject({ k: 'pal', ice: true });
    expect(at(g, 1, 1)).not.toBeNull(); // the boxed-in cell refills on its own
  });

  it.each(['down', 'up', 'left', 'right'] as Dir[])('gravity %s: pieces slide past holes in the mask', (dir) => {
    const rows = ['1x1', 'x*x', '1x1'];
    const g = grid(rows);
    collapse(g, maskFrom(rows), mulberry32(3), 4, counter(100), dir);
    for (const [r, c] of [[0, 1], [1, 0], [1, 2], [2, 1]] as const) expect(at(g, r, c)).toBeNull();
    expect(at(g, 1, 1)).not.toBeNull();
  });

  it('sideways gravity moves specials and stranded pals like pals, and keeps their order', () => {
    const rows = ['B1*P*'];
    const g = grid(rows);
    collapse(g, maskFrom(rows), mulberry32(4), 4, counter(100), 'right');
    expect(show(g)).toEqual(['ppBpP']);
    expect(at(g, 0, 3)).toMatchObject({ k: 'pal', c: 1 });
    const g2 = grid(rows);
    collapse(g2, maskFrom(rows), mulberry32(4), 4, counter(100), 'left');
    expect(show(g2)).toEqual(['BpPpp']);
  });

  it('several gaps: new pieces line up outside the entry edge in order', () => {
    const rows = ['1', '*', '*', '2'];
    const g = grid(rows);
    const { spawned } = collapse(g, maskFrom(rows), mulberry32(5), 4, counter(100), 'up');
    expect(at(g, 0, 0)).toMatchObject({ c: 1 });
    expect(at(g, 1, 0)).toMatchObject({ c: 2 });
    expect(spawned.map((s) => [s.r, s.fromR])).toEqual([[3, 5], [2, 4]]);
  });
});

describe('tidepool tide schedule', () => {
  const tide = { high: 3, low: 2, dir: 'left' as const };
  it('runs high then low, round again, and always says how many moves remain', () => {
    const phases = Array.from({ length: 11 }, (_, m) => { const t = tidePhase(tide, m); return `${t.phase[0]}${t.left}${t.dir[0]}`; });
    expect(phases).toEqual(['h3d', 'h2d', 'h1d', 'l2l', 'l1l', 'h3d', 'h2d', 'h1d', 'l2l', 'l1l', 'h3d']);
    expect(tidePhase(tide, 0).nextDir).toBe('left');
    expect(tidePhase(tide, 3).nextDir).toBe('down');
  });

  it('turns exactly on the boundary moves', () => {
    const turns = Array.from({ length: 11 }, (_, m) => tideTurns(tide, m));
    expect(turns.map((t, m) => (t ? m : -1)).filter((m) => m >= 0)).toEqual([3, 5, 8, 10]);
    expect(tideTurns(undefined, 3)).toBe(false);
  });

  it('a level without a tide is high tide for ever', () => {
    expect(tidePhase(undefined, 99)).toMatchObject({ phase: 'high', dir: 'down', left: Infinity });
  });
});

describe('tidepool rock pools', () => {
  const def: LevelDef = {
    n: 1, moves: 20, colors: 4, goals: [{ t: 'collect', c: 0, n: 5 }],
    layout: ['.......', '.......', '.......', '.......', '.......', '.......', 'oo...oo', 'oo...oo'],
    tide: { high: 4, low: 3, dir: 'up' },
  };
  it('are empty water at high tide and hold pieces at low tide', () => {
    const rock = rockOf(def);
    const high = buildBoard(def, mulberry32(1), counter(), 'high');
    expect(at(high, 7, 0)).toBeNull();
    expect(at(high, 6, 6)).toBeNull();
    const low = buildBoard(def, mulberry32(1), counter(), 'low');
    expect(at(low, 7, 0)).toMatchObject({ k: 'pal' });
    expect(activeMask(maskFrom(def.layout), rock, 'high')[7]![0]).toBe(false);
    expect(activeMask(maskFrom(def.layout), rock, 'low')[7]![0]).toBe(true);
  });

  it('a falling tide slides the board toward its gravity and fills the rock pools', () => {
    const mask = maskFrom(def.layout), rock = rockOf(def);
    const g = buildBoard(def, mulberry32(2), counter(), 'high');
    const t = turnTide(g, mask, rock, 'low', 'up', mulberry32(3), 4, counter(500));
    expect(t.washed).toEqual([]);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) expect(at(g, r, c)).not.toBeNull();
    expect(t.spawned.length).toBe(8); // one new piece per rock-pool cell, entering from the bottom edge
    expect(t.spawned.every((s) => s.fromR >= ROWS)).toBe(true);
  });

  it('a rising tide washes rock-pool pieces out to sea, and they count toward goals of their colour', () => {
    const mask = maskFrom(def.layout), rock = rockOf(def);
    const g = buildBoard(def, mulberry32(4), counter(), 'low');
    const colours: Record<number, number> = {};
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = at(g, r, c);
      if (rock[r]![c] && x?.k === 'pal') colours[x.c] = (colours[x.c] || 0) + 1;
    }
    const t = turnTide(g, mask, rock, 'high', 'down', mulberry32(5), 4, counter(500));
    expect(t.washed).toHaveLength(8);
    expect(t.counts.collect).toEqual(colours);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) expect(at(g, r, c) === null).toBe(rock[r]![c]);
    const p = addProgress(newProgress(), t.counts);
    expect(goalStatus(def, p)[0]!.got).toBe(Math.min(5, colours[0] || 0));
  });

  it('washOut counts a special as one of its colour and does not set it off', () => {
    const rows = ['B1', '22'];
    const g = grid(rows);
    const { washed, counts } = washOut(g, [[true, true], [false, false]]);
    expect(washed.map((w) => w.cell.k)).toEqual(['sp', 'pal']);
    expect(counts.collect).toEqual({ 0: 1, 1: 1 });
    expect(show(g)).toEqual(['**', 'pp']);
  });
});

describe('tidepool rescue', () => {
  it('a stranded pal is not matchable and specials never destroy it', () => {
    const g = grid(put(put(CHECKER, 3, 3, 'B'), 3, 4, 'P'));
    expect(resolveTap(g, 3, 4, counter(100)).ok).toBe(false);
    const r = resolveTap(g, 3, 3, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(at(r.grid, 3, 4)).toMatchObject({ k: 'lost' });
    expect(r.cleared.some((x) => x.cell.k === 'lost')).toBe(false);
    // a whirl + whirl combo clears everything, except the stranded pal
    const all = grid(put(put(put(CHECKER, 0, 0, 'P'), 4, 4, 'B'), 4, 5, 'B'));
    const w = resolveTap(all, 4, 4, counter(100));
    if (!w.ok) throw new Error('expected ok');
    expect(at(w.grid, 0, 0)).toMatchObject({ k: 'lost' });
  });

  it('it falls with gravity when pieces under it clear, and is rescued at the exit edge', () => {
    const rows = ['P', '1', '1', '2'];
    const mask = maskFrom(rows);
    const r = resolveTap(grid(rows), 1, 0, counter(100));
    if (!r.ok) throw new Error('expected ok');
    collapse(r.grid, mask, mulberry32(1), 4, counter(200), 'down');
    expect(show(r.grid)).toEqual(['p', 'p', 'P', 'p']);
    expect(rescueLost(r.grid, mask, 'down')).toEqual([]); // not at the edge yet: the colour-2 pal is under it
    r.grid[3]![0] = null;
    collapse(r.grid, mask, mulberry32(1), 4, counter(300), 'down');
    const saved = rescueLost(r.grid, mask, 'down');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ r: 3, c: 0, cell: { k: 'lost' } });
    expect(at(r.grid, 3, 0)).toBeNull();
  });

  it('tide gravity carries it sideways to a side exit', () => {
    const rows = ['P1*'];
    const g = grid(rows), mask = maskFrom(rows);
    collapse(g, mask, mulberry32(1), 4, counter(100), 'right');
    expect(show(g)).toEqual(['pPp']);
    expect(rescueLost(g, mask, 'right')).toEqual([]);
    g[0]![2] = null;
    collapse(g, mask, mulberry32(1), 4, counter(100), 'right');
    expect(rescueLost(g, mask, 'right')).toHaveLength(1);
  });

  it('the exit edge follows the mask: a pal over a hole is already at the open water', () => {
    const mask = maskFrom(['..', '.x']);
    expect(atExit(mask, 0, 1, 'down')).toBe(true);
    expect(atExit(mask, 0, 0, 'down')).toBe(false);
    expect(atExit(mask, 1, 0, 'right')).toBe(true);
  });

  it('litter under the pal holds it up until it breaks', () => {
    const rows = ['P', 'l'];
    const g = grid(rows), mask = maskFrom(rows);
    collapse(g, mask, mulberry32(1), 4, counter(100), 'down');
    expect(rescueLost(g, mask, 'down')).toEqual([]);
  });

  it('rescue goals count stranded pals', () => {
    const def: LevelDef = { n: 5, moves: 20, colors: 4, goals: [{ t: 'rescue', n: 1 }], layout: ['..P....', ...CHECKER.slice(1).map(() => '.......')], exit: 'down' };
    const p = newProgress();
    expect(goalsMet(def, p)).toBe(false);
    addProgress(p, { rescue: 1 });
    expect(goalStatus(def, p)[0]).toMatchObject({ t: 'rescue', need: 1, got: 1, done: true });
  });
});

describe('tidepool litter', () => {
  it('breaks like sand when a match touches it, and counts toward a litter goal', () => {
    const g = grid(['l00l', '1002']);
    const r = resolveTap(g, 0, 1, counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.counts.litter).toBe(2);
    expect(r.counts.sand).toBe(0);
    expect(resolveTap(g, 0, 0, counter(100)).ok).toBe(false); // litter is not tappable
    const def: LevelDef = { n: 7, moves: 20, colors: 4, goals: [{ t: 'litter' }], layout: ['l.....l', ...CHECKER.slice(1).map(() => '.......')] };
    const p = addProgress(newProgress(), r.counts);
    expect(goalStatus(def, p)[0]).toMatchObject({ need: 2, got: 2, done: true });
  });

  it('buildBoard lays out litter, rock pools and stranded pals from the layout', () => {
    const def: LevelDef = { n: 1, moves: 20, colors: 4, goals: [{ t: 'litter' }],
      layout: ['P......', '.......', '.......', '.......', '.......', '.......', 'lll.lll', '.......'] };
    const g = buildBoard(def, mulberry32(9), counter());
    expect(at(g, 0, 0)).toMatchObject({ k: 'lost' });
    expect([0, 1, 2].map((c) => (at(g, 6, c) as { v: number }).v).sort()).toEqual([0, 1, 2]); // cans, rings, bottles
  });
});

describe('tidepool helpers', () => {
  const ids = (cells: { cell: Cell }[]) => cells.length;
  it('every one of the 12 pals has an ability, charge rising with rarity', () => {
    expect(Object.keys(ABILITIES).sort()).toEqual(
      ['abyssa', 'bloop', 'coralie', 'fizz', 'gloam', 'lumen', 'marlo', 'pebbin', 'snapjaw', 'spindle', 'tango', 'wisp']);
    const common = ['pebbin', 'fizz', 'bloop', 'tango', 'gloam', 'wisp'], rare = ['snapjaw', 'spindle', 'lumen'];
    for (const [id, a] of Object.entries(ABILITIES)) {
      expect(a.charge).toBe(common.includes(id) ? 10 : rare.includes(id) ? 14 : 18);
      expect(a.tc).toBeGreaterThanOrEqual(0);
      expect(a.tc).toBeLessThan(5);
    }
  });

  it('charges from cleared pals of its colour only', () => {
    expect(helperCharge({ collect: { 0: 3, 1: 2 } }, 'snapjaw')).toBe(3);
    expect(helperCharge({ collect: { 1: 2 } }, 'snapjaw')).toBe(0);
    expect(helperCharge({ collect: { 0: 3 } }, 'nobody')).toBe(0);
  });

  it('Snapjaw clears the tapped column, breaking blockers and leaving the stranded pal', () => {
    const rows = put(put(put(CHECKER, 0, 2, 's'), 3, 2, 'n'), 5, 2, 'P');
    const r = applyAbility(grid(rows), 'snapjaw', 4, 2, mulberry32(1), counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(ids(r.cleared)).toBe(ROWS - 3);
    expect(r.counts.sand).toBe(1);
    expect(r.counts.ice).toBe(1);
    expect(at(r.grid, 5, 2)).toMatchObject({ k: 'lost' });
    expect(at(r.grid, 3, 2)).toMatchObject({ k: 'pal', ice: false });
  });

  it('Coralie clears a cross, Spindle a 3x3, Fizz a 2x2 (clamped at the edge), and they set off specials', () => {
    const c = applyAbility(grid(CHECKER), 'coralie', 3, 3, mulberry32(1), counter(100));
    expect(c.ok && c.cleared.length).toBe(ROWS + COLS - 1);
    const s = applyAbility(grid(CHECKER), 'spindle', 3, 3, mulberry32(1), counter(100));
    expect(s.ok && s.cleared.length).toBe(9);
    const f = applyAbility(grid(CHECKER), 'fizz', ROWS - 1, COLS - 1, mulberry32(1), counter(100));
    if (!f.ok) throw new Error('expected ok');
    expect(f.cleared.map((x) => `${x.r},${x.c}`).sort()).toEqual([`${ROWS - 2},${COLS - 2}`, `${ROWS - 2},${COLS - 1}`, `${ROWS - 1},${COLS - 2}`, `${ROWS - 1},${COLS - 1}`]);
    const chain = applyAbility(grid(put(CHECKER, 3, 6, 'H')), 'spindle', 3, 5, mulberry32(1), counter(100));
    if (!chain.ok) throw new Error('expected ok');
    expect(chain.effects.map((e) => e.kind)).toEqual(['helper', 'wave-h']);
  });

  it('Bloop inks a 2x2 and Tango a plus into the tapped colour; both need a free pal', () => {
    const b = applyAbility(grid(CHECKER), 'bloop', 2, 2, mulberry32(1), counter(100));
    if (!b.ok) throw new Error('expected ok');
    expect(b.recolored).toHaveLength(2); // the checkerboard 2x2 has two of the other colour
    for (const [r, c] of [[2, 2], [2, 3], [3, 2], [3, 3]]) expect((at(b.grid, r, c) as { c: number }).c).toBe(1);
    const t = applyAbility(grid(CHECKER), 'tango', 3, 3, mulberry32(1), counter(100));
    expect(t.ok && t.recolored.length).toBe(4);
    expect(applyAbility(grid(put(CHECKER, 2, 2, 's')), 'bloop', 2, 2, mulberry32(1), counter(100)).ok).toBe(false);
  });

  it('Gloam clears only the tapped colour in its row and column', () => {
    const r = applyAbility(grid(CHECKER), 'gloam', 0, 0, mulberry32(1), counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.cleared.every((x) => x.cell.k === 'pal' && x.cell.c === 1)).toBe(true);
    expect(r.cleared).toHaveLength(Math.ceil(COLS / 2) + Math.ceil(ROWS / 2) - 1);
  });

  it('Wisp makes a bomb and Abyssa a whirlpool from the tapped pal, without counting a clear', () => {
    const w = applyAbility(grid(CHECKER), 'wisp', 1, 1, mulberry32(1), counter(100));
    if (!w.ok) throw new Error('expected ok');
    expect(at(w.grid, 1, 1)).toMatchObject({ k: 'sp', s: 'bomb', c: 1 });
    expect(w.counts.collect).toEqual({});
    const a = applyAbility(grid(CHECKER), 'abyssa', 1, 2, mulberry32(1), counter(100));
    expect(a.ok && at(a.grid, 1, 2)).toMatchObject({ k: 'sp', s: 'whirl', c: 2 });
    expect(applyAbility(grid(put(CHECKER, 1, 1, 'P')), 'wisp', 1, 1, mulberry32(1), counter(100)).ok).toBe(false);
  });

  it('Marlo turns 3 pals into bombs with the seeded board RNG: same seed, same bombs', () => {
    const run = (seed: number) => {
      const r = applyAbility(grid(CHECKER), 'marlo', 0, 0, mulberry32(seed), counter(100));
      if (!r.ok) throw new Error('expected ok');
      return r.made!.map((m) => `${m.r},${m.c}`);
    };
    expect(run(7)).toHaveLength(3);
    expect(new Set(run(7)).size).toBe(3);
    expect(run(7)).toEqual(run(7));
  });

  it('Pebbin breaks the 3 lowest blockers', () => {
    const rows = put(put(put(put(CHECKER, 0, 0, 'l'), 6, 1, 's'), 7, 3, 'l'), 7, 5, 'n');
    const r = applyAbility(grid(rows), 'pebbin', 0, 0, mulberry32(1), counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.counts).toMatchObject({ litter: 1, ice: 1, sand: 1 });
    expect(at(r.grid, 0, 0)).toMatchObject({ k: 'litter' });
    expect(applyAbility(grid(CHECKER), 'pebbin', 0, 0, mulberry32(1), counter(100)).ok).toBe(false);
  });

  it('Lumen lights the biggest group, and that move counts double', () => {
    const r = applyAbility(grid(put(put(CHECKER, 0, 1, '1'), 1, 0, '1')), 'lumen', 0, 0, mulberry32(1), counter(100));
    if (!r.ok) throw new Error('expected ok');
    expect(r.double).toBe(true);
    expect(r.highlight).toHaveLength(6); // the two recoloured cells join four colour-1 neighbours
    expect(doubleCounts({ collect: { 1: 4 }, sand: 1, ice: 0, litter: 0 })).toEqual({ collect: { 1: 8 }, sand: 1, ice: 0, litter: 0 });
    expect(applyAbility(grid(CHECKER), 'lumen', 0, 0, mulberry32(1), counter(100)).ok).toBe(false);
  });

  it('abilities never change the grid they are given', () => {
    for (const id of Object.keys(ABILITIES)) {
      const g = grid(CHECKER);
      const before = JSON.stringify(g);
      applyAbility(g, id, 3, 3, mulberry32(1), counter(100));
      expect(JSON.stringify(g)).toBe(before);
    }
  });
});
