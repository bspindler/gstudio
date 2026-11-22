import { describe, expect, it } from 'vitest';

import { endlessLevel } from '../../../games/lanternkeep/lib/endless.js';
import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import { DT, ENEMIES, TOWER_ORDER, callWave, createGame, step, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';

type Def = { name: string; tip: string; speed: number; charge: { speed: number; minRun: number; margin: number } };
const DEF = (ENEMIES as unknown as Record<string, Def>).stag!;
type Stag = { d: number; charging?: boolean };

function lane(): Level {
  // one 8-cell straight, a turn, then a 2-cell stretch
  return { name: 't', intro: '', lives: 20, gold: 0, towers: [...TOWER_ORDER], paths: [[[0, 1], [8, 1], [8, 3]]], waves: [[['stag', 1, 1]]] as unknown as Group[][] };
}

describe('lanternkeep: Gloam Stag', () => {
  it('is a heavy creature with a tip', () => {
    expect(DEF.name).toBe('Gloam Stag');
    expect(DEF.tip.length).toBeGreaterThan(10);
    expect(DEF.charge.speed).toBeGreaterThan(DEF.speed * 2);
  });

  it('walks slowly, then charges along long straights only', () => {
    const g = createGame(lane());
    callWave(g);
    let walked = 0, charged = 0, prev = 0, walkStep = 0, chargeStep = 0;
    for (let i = 0; i < 6000 && g.phase === 'wave'; i++) {
      step(g);
      const s = g.enemies[0] as unknown as Stag | undefined;
      if (!s) break;
      const dd = s.d - prev;
      prev = s.d;
      if (s.charging) { charged++; chargeStep = Math.max(chargeStep, dd); } else { walked++; walkStep = Math.max(walkStep, dd); }
      if (s.d > 8) expect(s.charging).toBeFalsy();
    }
    expect(walked).toBeGreaterThan(0);
    expect(charged).toBeGreaterThan(0);
    expect(chargeStep).toBeGreaterThan(walkStep * 2);
    expect(walkStep).toBeLessThanOrEqual(DEF.speed * DT + 1e-9);
  });

  it('only joins Night Watch waves after night 15 and the story nights have none', () => {
    for (const l of LEVELS) expect(l.waves.flat().some((gr) => (gr[0] as string) === 'stag')).toBe(false);
    const waves = endlessLevel().waves as unknown as [string, number][][];
    for (const [i, w] of waves.entries()) if (i <= 14) expect(w.some(([t]) => t === 'stag'), `wave ${i}`).toBe(false);
    expect(waves.some((w) => w.some(([t]) => t === 'stag'))).toBe(true);
  });

  it('sends a stag herd every other night from night 16, sized from the wave budget', () => {
    const waves = endlessLevel().waves as unknown as [string, number][][];
    const herd = (i: number) => waves[i]!.find(([t]) => t === 'stag')?.[1] ?? 0;
    expect(herd(15)).toBeGreaterThanOrEqual(2);
    expect(herd(17)).toBeGreaterThanOrEqual(2);
    expect(herd(41)).toBeGreaterThan(herd(15));
  });
});
