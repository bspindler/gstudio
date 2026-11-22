import { describe, expect, it } from 'vitest';

const { LEVELS, FLOOR_THINGS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: { name: string; map: string[] }[];
  FLOOR_THINGS: string;
};

describe('gearhold cinder mites', () => {
  it('are a floor thing and Boiler Stair has them in swarms of three', () => {
    expect(FLOOR_THINGS).toContain('m');
    const boiler = LEVELS.find((l) => l.name === 'Boiler Stair')!;
    const runs = boiler.map.flatMap((row) => row.match(/m+/g) ?? []);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const r of runs) expect(r.length).toBe(3);
  });
});
