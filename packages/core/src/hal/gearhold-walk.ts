// Walks one Gearhold map the way a player must: start, key (if a locked door blocks the exit), exit.
import { FLOOR_THINGS, WALLS } from '../../../../games/gearhold/levels.js';

export type Cell = [number, number]; // [x, y]
export type Walk = {
  route: Cell[]; keyFirst: boolean;
  threatOnRoute: number; supplyOnRoute: number; startThreat: number;
  problems: string[];
};

export const THREAT: Record<'d' | 'c' | 'b' | 't', number> = { d: 2, c: 1, b: 5, t: 2 };
export const SIGHT = 5, DETOUR = 4, SAFE = 4;

const DOORS = 'DK';
const DIRS: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const at = (map: string[], x: number, y: number): string => map[y]?.[x] ?? '#';
const solid = (c: string): boolean => WALLS.includes(c) || DOORS.includes(c);

function find(map: string[], ch: string): Cell[] {
  const out: Cell[] = [];
  map.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push([x, y]); }));
  return out;
}

/** Shortest path from `from` to the nearest cell satisfying `goal`; locked doors pass only when keyed. */
function path(map: string[], from: Cell, goal: (x: number, y: number) => boolean, keyed: boolean): Cell[] | null {
  const prev = new Map<string, Cell | null>([[`${from[0]},${from[1]}`, null]]);
  const queue: Cell[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!;
    if (goal(x, y)) {
      const out: Cell[] = [];
      for (let c: Cell | null | undefined = [x, y]; c; c = prev.get(`${c[0]},${c[1]}`)) out.push(c);
      return out.reverse();
    }
    for (const [dx, dy] of DIRS) {
      const nx = x + dx!, ny = y + dy!, id = `${nx},${ny}`, c = at(map, nx, ny);
      if (prev.has(id) || WALLS.includes(c) || (c === 'K' && !keyed)) continue;
      prev.set(id, [x, y]);
      queue.push([nx, ny]);
    }
  }
  return null;
}

/** Cells within `steps` of any source, walking through everything but walls. Returns cell -> distance. */
function within(map: string[], sources: Cell[], steps: number): Map<string, number> {
  const dist = new Map<string, number>(sources.map(([x, y]) => [`${x},${y}`, 0]));
  const queue = [...sources];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!;
    const d = dist.get(`${x},${y}`)!;
    if (d >= steps) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx!, ny = y + dy!, id = `${nx},${ny}`;
      if (dist.has(id) || WALLS.includes(at(map, nx, ny))) continue;
      dist.set(id, d + 1);
      queue.push([nx, ny]);
    }
  }
  return dist;
}

function threatNear(map: string[], sources: Cell[], steps: number): number {
  const seen = within(map, sources, steps);
  let sum = 0;
  for (const ch of Object.keys(THREAT) as ('d' | 'c' | 'b' | 't')[])
    for (const [x, y] of find(map, ch)) if (seen.has(`${x},${y}`)) sum += THREAT[ch];
  return sum;
}

export function walkLevel(map: string[]): Walk {
  const problems: string[] = [];
  const w = map[0]?.length ?? 0, h = map.length;
  if (h <= 4 || map.some((r) => r.length !== w)) problems.push('not a rectangle');
  const known = new Set([...WALLS, ...DOORS, ...FLOOR_THINGS, '.', 'S']);
  for (const c of new Set(map.join(''))) if (!known.has(c)) problems.push(`unknown tile "${c}"`);
  const sealed = map.every((r, y) => y > 0 && y < h - 1
    ? WALLS.includes(r[0] ?? '.') && WALLS.includes(r[r.length - 1] ?? '.')
    : [...r].every((c) => WALLS.includes(c)));
  if (!sealed) problems.push('not sealed');
  const starts = find(map, 'S'), exits = find(map, 'X');
  if (starts.length !== 1) problems.push('needs exactly one start');
  if (exits.length === 0) problems.push('no exit');
  for (const ch of DOORS) for (const [x, y] of find(map, ch)) {
    const ew = solid(at(map, x - 1, y)) && solid(at(map, x + 1, y));
    const ns = solid(at(map, x, y - 1)) && solid(at(map, x, y + 1));
    if (!(ew || ns)) problems.push(`door at ${x},${y} cannot slide`);
  }

  const empty: Walk = { route: [], keyFirst: false, threatOnRoute: 0, supplyOnRoute: 0, startThreat: 0, problems };
  const start = starts[0];
  if (!start || exits.length === 0) return empty;

  const nextToExit = (x: number, y: number): boolean =>
    !WALLS.includes(at(map, x, y)) && exits.some(([ex, ey]) => Math.abs(ex - x) + Math.abs(ey - y) === 1);
  const hasLocked = find(map, 'K').length > 0;
  let route: Cell[] | null = null;
  let keyFirst = false;
  let keyed = false;
  const direct = path(map, start, nextToExit, false);
  const toKey = path(map, start, (x, y) => at(map, x, y) === 'k', false);
  if (hasLocked && !toKey) problems.push('key unreachable before locked door');
  if (direct) route = direct;
  else if (toKey) {
    keyed = true;
    const out = path(map, toKey[toKey.length - 1]!, nextToExit, true);
    if (out) { route = [...toKey, ...out.slice(1)]; keyFirst = true; }
  }
  if (!route) problems.push('exit unreachable');

  const reachable = (x: number, y: number): boolean => path(map, start, (gx, gy) => gx === x && gy === y, keyed || !!toKey) !== null;
  for (const ch of FLOOR_THINGS) for (const [x, y] of find(map, ch))
    if (!reachable(x, y)) problems.push(`${ch} at ${x},${y} unreachable`);

  if (!route) return empty;
  return {
    route, keyFirst, problems,
    threatOnRoute: threatNear(map, route, SIGHT),
    supplyOnRoute: find(map, 'h').filter(([x, y]) => within(map, route!, DETOUR).has(`${x},${y}`)).length,
    startThreat: threatNear(map, [start], SAFE),
  };
}

/** Shortest cell path (BFS) to the nearest goal cell; reused by the play bot. Locked doors pass only when `keyed`. */
export const routePath = path;
