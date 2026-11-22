import { describe, expect, it } from 'vitest';

type Level = { name: string; hint: string; map: string[] };
const { LEVELS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as { LEVELS: Level[] };

const count = (map: string[], ch: string) => map.join('').split('').filter((c) => c === ch).length;

describe('gearhold bellworks', () => {
  it('level 10 is Bellworks: one golem on a kilnwarden tile, no key, no small fast foes, a clear start', () => {
    const l = LEVELS[9]!;
    expect(l.name).toBe('Bellworks');
    expect(count(l.map, 'b')).toBe(1);
    expect(count(l.map, 'k') + count(l.map, 'K')).toBe(0);
    for (const ch of 'dcrtmg') expect(count(l.map, ch), ch).toBe(0);
    const row = l.map.findIndex((r) => r.includes('S')), col = l.map[row]!.indexOf('S');
    const gy = l.map.findIndex((r) => r.includes('b')), gx = l.map[gy]!.indexOf('b');
    expect(Math.abs(gx - col) + Math.abs(gy - row)).toBeGreaterThan(20);
  });
});
