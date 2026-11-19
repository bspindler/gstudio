import { describe, expect, it } from 'vitest';

type Level = { name: string; map: string[] };
const { LEVELS, FLOOR_THINGS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: Level[];
  FLOOR_THINGS: string;
};

describe('gearhold level 7, Ram Foundry', () => {
  const lvl = LEVELS[6];
  it('is level 7 and places several brass rams (r)', () => {
    expect(lvl?.name).toBe('Ram Foundry');
    expect(FLOOR_THINGS).toContain('r');
    const rams = lvl!.map.join('').split('').filter((c) => c === 'r').length;
    expect(rams).toBeGreaterThanOrEqual(3);
  });
  it('gives the rams room to charge: a straight open run of at least 5 cells beside each', () => {
    const { map } = lvl!;
    map.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== 'r') return;
      let run = 1;
      for (let i = x + 1; i < row.length && '.rdwhaoc'.includes(map[y]![i]!); i++) run++;
      for (let i = x - 1; i >= 0 && '.rdwhaoc'.includes(map[y]![i]!); i--) run++;
      expect(run, `ram at ${x},${y}`).toBeGreaterThanOrEqual(5);
    }));
  });
});
