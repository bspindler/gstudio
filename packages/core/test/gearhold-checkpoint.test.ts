import { describe, expect, it } from 'vitest';

type Level = { name: string; map: string[] };
type Checkpoint = { level: number; x: number; y: number; shells: number; scatter: boolean; dead: number[]; taken: number[]; doors: number[] };
const { LEVELS, WALLS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: Level[];
  WALLS: string;
};
const { makeCheckpoint, parseCheckpoint } = (await import(new URL('../../../games/gearhold/checkpoint.js', import.meta.url).href)) as {
  makeCheckpoint: (c: Checkpoint) => Checkpoint;
  parseCheckpoint: (raw: string | null, levels: Level[], walls: string) => Checkpoint | null;
};

const keyCell = (map: string[]) => {
  const y = map.findIndex((r) => r.includes('k'));
  return y < 0 ? null : ([map[y]!.indexOf('k'), y] as const);
};

describe('gearhold gear-key checkpoint', () => {
  const withKey = LEVELS.map((l, i) => [i, l, keyCell(l.map)] as const).filter(([, , k]) => k);

  it('has a gear key on at least one level to checkpoint at', () => {
    expect(withKey.length).toBeGreaterThan(0);
  });

  it.each(withKey)('level %i: a checkpoint at the key round-trips through storage', (i, _l, k) => {
    const cp = makeCheckpoint({ level: i, x: k![0] + 0.5, y: k![1] + 0.5, shells: 7, scatter: true, dead: [0, 2], taken: [1], doors: [5] });
    const back = parseCheckpoint(JSON.stringify(cp), LEVELS, WALLS);
    expect(back).toEqual(cp);
  });

  it('rejects anything malformed, out of range or inside a wall (fresh level start instead)', () => {
    const [i, level, k] = withKey[0]!;
    const ok = { level: i, x: k![0] + 0.5, y: k![1] + 0.5, shells: 0, scatter: false, dead: [], taken: [], doors: [] };
    const wallY = level.map.findIndex((r) => r.includes('#'));
    const wallX = level.map[wallY]!.indexOf('#');
    for (const raw of [
      null, '', 'nope', '[]', '{}',
      JSON.stringify({ ...ok, level: LEVELS.length }),
      JSON.stringify({ ...ok, level: -1 }),
      JSON.stringify({ ...ok, x: 'a' }),
      JSON.stringify({ ...ok, x: wallX + 0.5, y: wallY + 0.5 }),
      JSON.stringify({ ...ok, x: -3 }),
      JSON.stringify({ ...ok, dead: [1.5] }),
      JSON.stringify({ ...ok, taken: 'x' }),
    ]) expect(parseCheckpoint(raw, LEVELS, WALLS), String(raw)).toBeNull();
    expect(parseCheckpoint(JSON.stringify(ok), LEVELS, WALLS)).toEqual(ok);
  });

  it('clamps shells to the carry limit', () => {
    const [i, , k] = withKey[0]!;
    const cp = makeCheckpoint({ level: i, x: k![0] + 0.5, y: k![1] + 0.5, shells: 999, scatter: true, dead: [], taken: [], doors: [] });
    expect(cp.shells).toBe(50);
  });
});
