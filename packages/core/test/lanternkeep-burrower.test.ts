import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import { ENEMIES, TOWER_ORDER, callWave, createGame, step, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';

type Def = { name: string; tip: string; burrow: { from: number; len: number; every: number; fast: number } };
const DEF = (ENEMIES as unknown as Record<string, Def>).burrower!;

function lane(): Level {
  return { name: 't', intro: '', lives: 20, gold: 0, hpMul: 1, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves: [[['burrower', 1, 1]]] as unknown as Group[][] };
}

describe('lanternkeep: Dusk Burrower', () => {
  it('has a tip and a short dig', () => {
    expect(DEF.name).toBe('Dusk Burrower');
    expect(DEF.tip.length).toBeGreaterThan(10);
    expect(DEF.burrow.len).toBeLessThan(DEF.burrow.every);
  });

  it('is under only for a stretch, and surfaces further on', () => {
    const g = createGame(lane());
    callWave(g);
    let below = 0, above = 0, wasUnder = false, resurfaced = false;
    for (let i = 0; i < 900 && g.phase === 'wave'; i++) {
      step(g);
      const e = g.enemies[0] as unknown as { under: boolean } | undefined;
      if (!e) continue;
      if (e.under) { below++; wasUnder = true; } else { above++; if (wasUnder) resurfaced = true; }
    }
    expect(below).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(below);
    expect(resurfaced).toBe(true);
  });

  it('night 20 introduces it, after Lantern Hush, and no earlier night has it', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(20);
    expect(LEVELS[20 - 1]!.name).toBe('Burrow Hollow');
    expect(LEVELS[20 - 1]!.waves.flat().some((gr) => (gr[0] as string) === 'burrower')).toBe(true);
    for (const l of LEVELS.slice(0, 19)) expect(l.waves.flat().some((gr) => (gr[0] as string) === 'burrower')).toBe(false);
  });
});
