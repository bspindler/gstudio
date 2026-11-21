import { describe, expect, it } from 'vitest';

type Level = { name: string; hint: string; map: string[] };
const { LEVELS, FLOOR_THINGS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: Level[];
  FLOOR_THINGS: string;
};

const count = (map: string[], ch: string) => map.join('').split('').filter((c) => c === ch).length;

describe('gearhold turret gallery', () => {
  it('knows the turret tile', () => {
    expect(FLOOR_THINGS).toContain('t');
  });

  it('level 9 is the Turret Gallery: many turrets, no key, a start well clear of them', () => {
    const l = LEVELS[8]!;
    expect(l.name).toBe('Turret Gallery');
    expect(count(l.map, 't')).toBeGreaterThanOrEqual(6);
    expect(count(l.map, 'k')).toBe(0);
    expect(count(l.map, 'K')).toBe(0);
    // turrets are the main threat: they outnumber every other machine together
    const others = ['d', 'c', 'b', 'r'].reduce((n, ch) => n + count(l.map, ch), 0);
    expect(count(l.map, 't')).toBeGreaterThan(others);
    const row = l.map.findIndex((r) => r.includes('S'));
    const col = l.map[row]!.indexOf('S');
    for (let y = 0; y < l.map.length; y++) for (let x = 0; x < l.map[y]!.length; x++)
      if (l.map[y]![x] === 't') expect(Math.abs(x - col) + Math.abs(y - row), `turret at ${x},${y}`).toBeGreaterThan(8);
  });

  it('leaves the cell in front of every door free, so a turret never blocks a doorway', () => {
    for (const l of LEVELS) l.map.forEach((r, y) => [...r].forEach((c, x) => {
      if (c !== 'D' && c !== 'K') return;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(l.map[y! + dy!]![x + dx!], `${l.name} ${x},${y}`).not.toBe('t');
    }));
  });
});
