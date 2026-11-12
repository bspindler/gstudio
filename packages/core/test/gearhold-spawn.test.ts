import { describe, expect, it } from 'vitest';

type Level = { name: string; map: string[] };
const { LEVELS, WALLS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: Level[];
  WALLS: string;
};
const { spawnYaw, openRun } = (await import(new URL('../../../games/gearhold/spawn.js', import.meta.url).href)) as {
  spawnYaw: (map: string[], sx: number, sy: number, blocks: string) => number;
  openRun: (map: string[], sx: number, sy: number, dx: number, dy: number, blocks: string) => number;
};

const BLOCKS = WALLS + 'DK';
const start = (map: string[]) => {
  const y = map.findIndex((r) => r.includes('S'));
  return [map[y]!.indexOf('S'), y] as const;
};

describe('gearhold spawn yaw', () => {
  it('faces down the long hall rather than the first open neighbour', () => {
    const map = [
      '#######',
      '#S....#',
      '#.#####',
      '#######',
    ];
    // east has 4 open cells, south only 1: face east (yaw 0)
    expect(spawnYaw(map, 1, 1, BLOCKS)).toBe(0);
    const tall = ['####', '#S.#', '#..#', '#..#', '#..#', '####'];
    expect(spawnYaw(tall, 1, 1, BLOCKS)).toBeCloseTo(Math.PI / 2);
  });

  it.each(LEVELS.map((l, i) => [i + 1, l] as const))('level %i starts facing its longest open line', (_n, level) => {
    const [sx, sy] = start(level.map);
    const runs = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const).map(([dx, dy]) => openRun(level.map, sx, sy, dx, dy, BLOCKS));
    const a = spawnYaw(level.map, sx, sy, BLOCKS);
    const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
    const chosen = openRun(level.map, sx, sy, dx, dy, BLOCKS);
    expect(chosen).toBe(Math.max(...runs));
    expect(chosen, `${level.name} faces a wall`).toBeGreaterThan(1);
  });
});
