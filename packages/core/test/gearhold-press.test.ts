import { describe, expect, it } from 'vitest';

const { PRESS, pressState, pressOffset } = (await import(new URL('../../../games/gearhold/press.js', import.meta.url).href)) as {
  PRESS: { period: number; warn: number; down: number; dmg: number };
  pressState: (t: number, x: number) => 'open' | 'warn' | 'down';
  pressOffset: (x: number) => number;
};
const { LEVELS } = (await import(new URL('../../../games/gearhold/levels.js', import.meta.url).href)) as {
  LEVELS: { name: string; map: string[] }[];
};

describe('gearhold presses', () => {
  it('thump on a steady, repeating rhythm (no randomness)', () => {
    for (let t = 0; t < 12; t += 0.173) expect(pressState(t, 9)).toBe(pressState(t + PRESS.period, 9));
    expect(pressState(1.234, 13)).toBe(pressState(1.234, 13));
  });

  it('rest most of the time, warn before they slam, and slam briefly', () => {
    const n = 4000, count = { open: 0, warn: 0, down: 0 };
    for (let i = 0; i < n; i++) count[pressState((i / n) * PRESS.period, 9)]++;
    expect(count.open / n).toBeGreaterThan(0.6);
    expect(count.warn / n).toBeGreaterThan(0.1);
    expect(count.down / n).toBeLessThan(0.12);
    expect(PRESS.warn).toBeGreaterThanOrEqual(0.5);
  });

  it('always shows warn right before down', () => {
    for (let t = 0; t < PRESS.period; t += 0.01) if (pressState(t, 9) === 'down' && pressState(t - 0.05, 9) !== 'down') expect(pressState(t - 0.05, 9)).toBe('warn');
  });

  it('offsets neighbouring columns so the beat travels down the gallery', () => {
    expect(pressOffset(13)).not.toBe(pressOffset(9));
  });

  it('level 4 is the Press Gallery, with presses and the last ones near the exit', () => {
    const l = LEVELS[3]!;
    expect(l.name).toBe('Press Gallery');
    const cells: [number, number][] = [];
    l.map.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'u') cells.push([x, y]); }));
    expect(cells.length).toBeGreaterThanOrEqual(12);
    const exitX = Math.max(...l.map.flatMap((row) => [...row].flatMap((c, x) => (c === 'X' ? [x] : []))));
    expect(Math.max(...cells.map(([x]) => x))).toBeGreaterThan(exitX - 12);
    expect(l.map[0]!.length).toBeGreaterThanOrEqual(32);
  });
});
