import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import { ENEMIES, TOWER_ORDER, callWave, createGame, place, step, type Game, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';

type Twin = { type: string; hp: number; maxHp: number; half?: boolean; d: number };
const twins = (g: Game) => g.enemies as unknown as Twin[];
const DEF = (ENEMIES as unknown as Record<string, { name: string; tip: string; twin: boolean }>).twinwisp!;

function lane(waves: unknown[][]): Level {
  return { name: 't', intro: '', lives: 20, gold: 900, hpMul: 1, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves: waves as Group[][] };
}

describe('lanternkeep: Twin Wisp (night 18, Mirror Mist)', () => {
  it('is defined with a tip', () => {
    expect(DEF.name).toBe('Twin Wisp');
    expect(DEF.twin).toBe(true);
    expect(DEF.tip.length).toBeGreaterThan(10);
  });

  it('splits in two when struck and survives, sharing the health; halves do not split again', () => {
    const g = createGame(lane([[['twinwisp', 1, 1]]]));
    place(g, 'glowcap', 3, 3);
    callWave(g);
    let splitAt = -1;
    for (let i = 0; i < 600 && g.phase === 'wave'; i++) {
      step(g);
      if (twins(g).length === 2 && splitAt < 0) {
        splitAt = i;
        const [a, b] = twins(g);
        expect(a!.half && b!.half).toBe(true);
        expect(a!.hp + b!.hp).toBeLessThan(a!.maxHp);
      }
    }
    expect(splitAt).toBeGreaterThanOrEqual(0);
  });

  it('only ever makes two from one', () => {
    const g = createGame(lane([[['twinwisp', 1, 1]]]));
    place(g, 'glowcap', 3, 3);
    place(g, 'glowcap', 5, 3);
    callWave(g);
    let most = 0;
    for (let i = 0; i < 900 && g.phase === 'wave'; i++) { step(g); most = Math.max(most, twins(g).length); }
    expect(most).toBe(2);
  });

  it('is night 18, after Lamplit Orchard, and uses Twin Wisps', () => {
    expect(LEVELS[17]!.name).toBe('Mirror Mist');
    expect(LEVELS[16]!.name).toBe('Lamplit Orchard');
    expect(LEVELS[17]!.waves.flat().some((gr) => (gr[0] as string) === 'twinwisp')).toBe(true);
  });
});
