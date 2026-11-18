import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import { DT, ENEMIES, TOWER_ORDER, callWave, createGame, place, step, useFlare, type Game, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';

type Mole = { under?: boolean; hp: number; maxHp: number; d: number };
const moles = (g: Game) => g.enemies as unknown as Mole[];
const DEF = (ENEMIES as unknown as Record<string, { dive: { up: number; down: number }; tip: string; name: string }>).mole!;

function lane(waves: unknown[][], extra: Partial<Level> = {}): Level {
  return { name: 't', intro: '', lives: 20, gold: 500, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves: waves as Group[][], ...extra };
}

describe('lanternkeep: Hollow Mole', () => {
  it('is a creature with a reveal tip', () => {
    expect(DEF.name).toBe('Hollow Mole');
    expect(DEF.tip.length).toBeGreaterThan(10);
  });

  it('dives under the path in a cycle and comes back up', () => {
    const g = createGame(lane([[['mole', 1, 1]]]));
    callWave(g);
    const seen = new Set<boolean>();
    let wasUnder = false, resurfaced = false;
    for (let i = 0; i < 400 && g.phase === 'wave'; i++) {
      step(g);
      const m = moles(g)[0];
      if (!m) break;
      const under = !!m.under;
      seen.add(under);
      if (wasUnder && !under) resurfaced = true;
      wasUnder = under;
      expect(under).toBe(m.d % (DEF.dive.up + DEF.dive.down) >= DEF.dive.up);
    }
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
    expect(resurfaced).toBe(true);
  });

  it('cannot be hit by plants, the Flare or burning ground while under, and can be when up', () => {
    const g = createGame(lane([[['mole', 1, 1]]]));
    place(g, 'glowcap', 3, 5);
    callWave(g);
    g.flareCd = 0;
    // run until it is under, then check it is untouched through the dive
    let guard = 0;
    while (!moles(g)[0]?.under && guard++ < 600) step(g);
    const m = moles(g)[0]!;
    expect(m.under).toBe(true);
    const hp = m.hp;
    useFlare(g);
    g.patches.push({ x: 4.5, y: 5.5, r: 99, dps: 50, left: 1 } as never);
    step(g);
    expect(m.hp).toBe(hp);
    // later it surfaces and plants hurt it again
    g.patches.length = 0;
    guard = 0;
    while (m.under && guard++ < 600) step(g);
    expect(m.under).toBe(false);
    const before = m.hp;
    for (let i = 0; i < Math.round(1 / DT) && m.hp === before; i++) step(g);
    expect(m.hp).toBeLessThan(before);
  });

  it('night 16 introduces it, after the existing nights, with moles in the waves', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(16);
    const n16 = LEVELS[15]!;
    expect(n16.name).toBe('Burrowing Dark');
    const types = new Set(n16.waves.flat().map((gr) => gr[0] as string));
    expect(types.has('mole')).toBe(true);
    for (const l of LEVELS.slice(0, 15)) expect(l.waves.flat().some((gr) => (gr[0] as string) === 'mole')).toBe(false);
  });
});
