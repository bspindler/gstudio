import { describe, expect, it } from 'vitest';

// Gearhold keeps its maps in a plain ES module so they can be checked here without a browser.
type Level = { name: string; hint: string; map: string[] };
const { LEVELS, WALLS, FLOOR_THINGS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: Level[];
  WALLS: string;
  FLOOR_THINGS: string;
};

const DOORS = 'DK';
const solid = (ch: string) => WALLS.includes(ch) || DOORS.includes(ch);

function find(map: string[], ch: string): [number, number][] {
  const out: [number, number][] = [];
  map.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push([x, y]); }));
  return out;
}

/** Cells reachable on foot from the start. Plain doors open; locked doors open only when keyed. */
function reach(map: string[], keyed: boolean): Set<string> {
  const [start] = find(map, 'S');
  const seen = new Set<string>();
  const queue: [number, number][] = start ? [start] : [];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    const id = `${x},${y}`;
    if (seen.has(id)) continue;
    const c = map[y]?.[x] ?? '#';
    if (WALLS.includes(c) || (c === 'K' && !keyed)) continue;
    seen.add(id);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

describe.each(LEVELS.map((l, i) => [i + 1, l] as const))('gearhold level %i', (_n, level) => {
  const { map } = level;

  it('is a rectangle made of known tiles', () => {
    expect(map.length).toBeGreaterThan(4);
    for (const row of map) expect(row.length).toBe(map[0]!.length);
    const known = new Set([...WALLS, ...DOORS, ...FLOOR_THINGS, '.', 'S']);
    for (const row of map) for (const c of row) expect(known.has(c), `unknown tile "${c}"`).toBe(true);
  });

  it('is sealed by walls on every edge', () => {
    const h = map.length, w = map[0]!.length;
    for (let x = 0; x < w; x++) expect(WALLS.includes(map[0]![x]!) && WALLS.includes(map[h - 1]![x]!)).toBe(true);
    for (let y = 0; y < h; y++) expect(WALLS.includes(map[y]![0]!) && WALLS.includes(map[y]![w - 1]!)).toBe(true);
  });

  it('has one start and an exit panel', () => {
    expect(find(map, 'S')).toHaveLength(1);
    expect(find(map, 'X').length).toBeGreaterThan(0);
  });

  it('gives a reachable key before any locked door', () => {
    if (find(map, 'K').length === 0) return;
    const open = reach(map, false);
    expect(find(map, 'k').some(([x, y]) => open.has(`${x},${y}`))).toBe(true);
  });

  it('lets the player reach the exit and everything placed in the level', () => {
    const hasKey = find(map, 'k').some(([x, y]) => reach(map, false).has(`${x},${y}`));
    const all = reach(map, hasKey);
    const touchesExit = find(map, 'X').some(([x, y]) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => all.has(`${x + dx!},${y + dy!}`)));
    expect(touchesExit).toBe(true);
    for (const ch of FLOOR_THINGS) for (const [x, y] of find(map, ch)) expect(all.has(`${x},${y}`), `${ch} at ${x},${y}`).toBe(true);
  });

  it('never puts a door where it cannot slide (walls on both sides along one axis)', () => {
    for (const ch of DOORS) for (const [x, y] of find(map, ch)) {
      const ew = solid(map[y]![x - 1]!) && solid(map[y]![x + 1]!);
      const ns = solid(map[y - 1]![x]!) && solid(map[y + 1]![x]!);
      expect(ew || ns, `door at ${x},${y}`).toBe(true);
    }
  });
});

describe('gearhold levels', () => {
  it('has at least three levels, each with a name and a hint', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(3);
    for (const l of LEVELS) expect(l.name.length * l.hint.length).toBeGreaterThan(0);
  });
});
