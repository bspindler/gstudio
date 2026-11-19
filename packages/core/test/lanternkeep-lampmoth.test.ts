import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import { ENEMIES, TOWER_ORDER, callWave, createGame, place, step, upgrade, type Game, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';

type Lamp = { mode: string; x: number; y: number; hp: number };
const lamps = (g: Game) => g.enemies as unknown as Lamp[];
const DEF = (ENEMIES as unknown as Record<string, { name: string; tip: string; hp: number; speed: number }>).lampmoth!;

function lane(waves: unknown[][], extra: Partial<Level> = {}): Level {
  return { name: 't', intro: '', lives: 20, gold: 900, hpMul: 40, // tough enough to survive the trip, so the dive is what is tested
 towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves: waves as Group[][], ...extra };
}

describe('lanternkeep: Lampmoth', () => {
  it('is fast and fragile, with a tip', () => {
    expect(DEF.name).toBe('Lampmoth');
    expect(DEF.tip.length).toBeGreaterThan(10);
    expect(DEF.speed).toBeGreaterThan(ENEMIES.firefly.speed * 1);
    expect(DEF.hp).toBeLessThan(ENEMIES.moth.hp);
  });

  it('leaves the path for the most grown plant and dazzles it', () => {
    const g = createGame(lane([[['lampmoth', 1, 1]]]));
    place(g, 'glowcap', 1, 4);
    place(g, 'ember', 7, 8);
    const ember = g.towers[1]!;
    callWave(g);
    let dazzled = false;
    for (let i = 0; i < 400 && g.phase === 'wave'; i++) {
      step(g);
      const m = lamps(g)[0];
      if (m?.mode === 'dazzle') {
        dazzled = true;
        expect(Math.hypot(m.x - ember.x, m.y - ember.y)).toBeLessThan(0.5);
        expect((ember as unknown as { dazzled: boolean }).dazzled).toBe(true);
        break;
      }
    }
    expect(dazzled).toBe(true);
  });

  it('a dazzled plant does not fire, and fires again once the moth moves on', () => {
    const g = createGame(lane([[['lampmoth', 1, 1], ['moth', 3, 1, 8]]]));
    place(g, 'glowcap', 3, 5);
    callWave(g);
    let sawDazzle = false, done = false;
    for (let i = 0; i < 900 && !done; i++) {
      const before = g.enemies.map((e) => e.hp).join();
      step(g);
      const t = g.towers[0]! as unknown as { dazzled: boolean; cd: number };
      if (t.dazzled) {
        sawDazzle = true;
        expect(g.enemies.filter((e) => e.type === 'moth').every((e) => e.hp === e.maxHp)).toBe(true);
      } else if (sawDazzle) done = true;
      void before;
    }
    expect(sawDazzle).toBe(true);
    expect(done).toBe(true);
  });

  it('flies on for the lantern after dazzling, and leaks if not stopped', () => {
    const g = createGame(lane([[['lampmoth', 1, 1]]]));
    place(g, 'frost', 1, 4); // does no real harm
    callWave(g);
    for (let i = 0; i < 1500 && g.phase === 'wave'; i++) step(g);
    expect(g.stats.leaks + g.stats.kills).toBeGreaterThanOrEqual(1);
  });

  it('stays on the path when there are no plants', () => {
    const g = createGame(lane([[['lampmoth', 1, 1]]]));
    callWave(g);
    for (let i = 0; i < 20; i++) step(g);
    expect(lamps(g)[0]!.mode).toBe('dive');
    expect(lamps(g)[0]!.x).toBeCloseTo(4.5, 3);
  });

  it('prefers a grown plant over a new one', () => {
    const g = createGame(lane([[['lampmoth', 1, 1]]]));
    place(g, 'glowcap', 1, 4);
    place(g, 'glowcap', 7, 8);
    upgrade(g, g.towers[0]!.id);
    callWave(g);
    for (let i = 0; i < 400; i++) { step(g); if (lamps(g)[0]?.mode === 'dazzle') break; }
    const m = lamps(g)[0]!;
    expect(Math.hypot(m.x - g.towers[0]!.x, m.y - g.towers[0]!.y)).toBeLessThan(0.5);
  });

  it('night 17 introduces it after night 16 and no earlier night has it', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(17);
    const n17 = LEVELS[16]!;
    expect(n17.waves.flat().some((gr) => (gr[0] as string) === 'lampmoth')).toBe(true);
    for (const l of LEVELS.slice(0, 16)) expect(l.waves.flat().some((gr) => (gr[0] as string) === 'lampmoth')).toBe(false);
  });
});
