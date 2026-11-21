import { describe, expect, it } from 'vitest';

import { DETOUR, SAFE, SIGHT, THREAT, walkLevel } from '../src/hal/gearhold-walk.js';

const keyed = [
  '##########',
  '#S..#k...#',
  '#...D....#',
  '#...#...K#',
  '#...#...X#',
  '##########',
];
// start | key room via D; K on the exit wall column
const locked = [
  '#########',
  '#S.D.k..#',
  '#####K###',
  '#.....X.#',
  '#########',
];

describe('walkLevel', () => {
  it('pins constants', () => {
    expect(THREAT).toEqual({ d: 2, c: 1, b: 5, t: 2 });
    expect([SIGHT, DETOUR, SAFE]).toEqual([5, 4, 4]);
  });

  it('visits the key before the locked door and ends next to X', () => {
    const w = walkLevel(locked);
    expect(w.problems).toEqual([]);
    expect(w.keyFirst).toBe(true);
    const idx = (x: number, y: number) => w.route.findIndex(([a, b]) => a === x && b === y);
    expect(idx(5, 1)).toBeGreaterThanOrEqual(0);
    expect(idx(5, 1)).toBeLessThan(idx(5, 2));
    const [lx, ly] = w.route[w.route.length - 1]!;
    expect(Math.abs(lx - 6) + Math.abs(ly - 3)).toBe(1);
  });

  it('does not need the key when the exit is open', () => {
    const w = walkLevel(['#####', '#S.X#', '#####', '#####', '#####']);
    expect(w.keyFirst).toBe(false);
    expect(w.problems).toEqual([]);
  });

  it('reports unreachable exit, locked key, unsealed edge, unknown tile', () => {
    expect(walkLevel(['#####', '#S#X#', '#####', '#####', '#####']).problems).toContain('exit unreachable');
    expect(walkLevel(['#######', '#S.K.kX#', '#######', '#######', '#######']).problems).toContain('key unreachable before locked door');
    expect(walkLevel(['#####', '#S.X.', '#####', '#####', '#####']).problems).toContain('not sealed');
    expect(walkLevel(['#####', '#S?X#', '#####', '#####', '#####']).problems).toContain('unknown tile "?"');
  });

  it('threat counts through open floor but not behind a wall; start threat uses SAFE', () => {
    const open = walkLevel(['#########', '#S.....X#', '#.......#', '#.......#', '#########']);
    expect(open.threatOnRoute).toBe(0);
    const seen = walkLevel(['#########', '#S....X.#', '#.......#', '#...d...#', '#########']);
    expect(seen.threatOnRoute).toBe(THREAT.d);
    const hidden = walkLevel(['#########', '#S....X.#', '#.#####.#', '#.#d..#.#', '#########']);
    expect(hidden.threatOnRoute).toBe(0);
    // crawler 5 steps from S (outside SAFE=4) is on the route's sight but not a start threat
    const far = walkLevel(['#############', '#S....c....X#', '#############', '#############', '#############']);
    expect(far.startThreat).toBe(0);
    expect(walkLevel(['#############', '#S...c.....X#', '#############', '#############', '#############']).startThreat).toBe(THREAT.c);
  });

  it('counts supply within DETOUR of the route', () => {
    const w = walkLevel(['#########', '#S.....X#', '#.......#', '#h......#', '#########']);
    expect(w.supplyOnRoute).toBe(1);
  });
});
