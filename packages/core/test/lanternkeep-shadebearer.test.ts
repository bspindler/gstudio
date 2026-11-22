import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import { ENEMIES, TOWER_ORDER, callWave, createGame, place, step, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';

const DEF = (ENEMIES as unknown as Record<string, { name: string; tip: string; shade: { r: number; slow: number; for: number } }>).shadebearer!;

function lane(waves: unknown[][]): Level {
  return { name: 't', intro: '', lives: 20, gold: 900, hpMul: 40, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves: waves as Group[][] };
}

// Counts shots from a plant standing at (cell) while a wave of the given type walks past.
function shots(type: string, c: number): number {
  const g = createGame(lane([[[type, 1, 1], ['moth', 6, 0.5, 2]]]));
  place(g, 'glowcap', c, 6);
  callWave(g);
  let n = 0, prev = 0;
  for (let i = 0; i < 600 && g.phase === 'wave'; i++) {
    step(g);
    const t = g.towers[0]!;
    if (t.cd > prev + 1e-9) n++;
    prev = t.cd;
  }
  return n;
}

describe('lanternkeep: Shadebearer', () => {
  it('has a tip and a dimming reach', () => {
    expect(DEF.name).toBe('Shadebearer');
    expect(DEF.tip.length).toBeGreaterThan(10);
    expect(DEF.shade.slow).toBeGreaterThan(0);
    expect(DEF.shade.slow).toBeLessThan(1);
  });

  it('a plant beside its path fires slower than the same plant with a moth passing', () => {
    expect(shots('shadebearer', 3)).toBeLessThan(shots('moth', 3));
  });

  it('a plant far from its path is not dimmed', () => {
    expect(shots('shadebearer', 0)).toBe(shots('moth', 0));
  });

  it('night 19 introduces it, after Mirror Mist, and no earlier night has it', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(19);
    expect(LEVELS[19 - 1]!.waves.flat().some((gr) => (gr[0] as string) === 'shadebearer')).toBe(true);
    for (const l of LEVELS.slice(0, 18)) expect(l.waves.flat().some((gr) => (gr[0] as string) === 'shadebearer')).toBe(false);
  });
});
