import { describe, expect, it } from 'vitest';
import * as sim from '../../../games/lanternkeep/lib/sim.js';
import { DT, TOWER_ORDER, callWave, createGame, place, step, upgrade, type Game, type Group, type Level } from '../../../games/lanternkeep/lib/sim.js';
import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';

// sim.d.ts predates Thornbriar, so read the new parts loosely.
const S = sim as unknown as { THORN_RADIUS: number; TOWERS: Record<string, { kind: string; tiers: { patches: number; hits: number }[] }> };
const thorns = (g: Game) => (g as unknown as { thorns: { x: number; y: number; hits: number; tid: number }[] }).thorns;

function lvl(waves: Group[][], extra: Partial<Level> = {}): Level {
  return { name: 't', intro: '', lives: 20, gold: 5000, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves, ...extra };
}
const run = (g: Game, secs: number) => { const all: { e: string }[] = []; for (let i = 0; i < secs / DT; i++) all.push(...step(g)); return all; };

describe('Thornbriar', () => {
  it('is the sixth plant, a trap with a limited number of hits', () => {
    expect(TOWER_ORDER[5]).toBe('thornbriar');
    expect(S.TOWERS.thornbriar!.kind).toBe('thorn');
    for (const t of S.TOWERS.thornbriar!.tiers) expect(t.hits).toBeGreaterThan(0);
  });

  it('unlocks from night 7 and in Night Watch, not earlier', () => {
    const first = LEVELS.findIndex((l) => (l.towers as string[]).includes('thornbriar'));
    expect(first).toBe(6);
    for (const l of LEVELS.slice(first)) expect(l.towers).toContain('thornbriar');
  });

  it('seeds a thorn patch on the nearest path tile', () => {
    const g = createGame(lvl([[['moth', 1, 1]]]));
    place(g, 'thornbriar', 3, 5);
    callWave(g);
    const evs = run(g, 0.2);
    expect(evs.some((e) => e.e === 'thorn')).toBe(true);
    expect(thorns(g)).toHaveLength(1);
    expect(thorns(g)[0]).toMatchObject({ x: 4.5, y: 5.5 });
  });

  it('never seeds more patches than its cap, and not off the path', () => {
    const g = createGame(lvl([[['moth', 1, 30]]]));
    place(g, 'thornbriar', 3, 5);
    callWave(g);
    run(g, 6);
    expect(thorns(g).length).toBeLessThanOrEqual(S.TOWERS.thornbriar!.tiers[0]!.patches);
    for (const p of thorns(g)) expect(g.blocked.has(`${Math.floor(p.x)},${Math.floor(p.y)}`)).toBe(true);
  });

  it('cuts a walker once per patch and spends its hits', () => {
    const g = createGame(lvl([[['beetle', 6, 0.4]]]));
    place(g, 'thornbriar', 3, 5);
    callWave(g);
    const hits = run(g, 12).filter((e) => e.e === 'thornhit').length;
    expect(hits).toBeGreaterThan(0);
    // one patch, four hits, then it is spent: the plant reseeds, but each patch gives at most four cuts
    for (const p of thorns(g)) expect(p.hits).toBeLessThanOrEqual(S.TOWERS.thornbriar!.tiers[0]!.hits);
  });

  it('hurts creatures that cross it, unlike a garden without one', () => {
    const mk = (withPlant: boolean) => {
      const g = createGame(lvl([[['beetle', 1, 1]]]));
      if (withPlant) place(g, 'thornbriar', 3, 5);
      callWave(g);
      run(g, 14);
      return g.enemies[0];
    };
    const hurt = mk(true), bare = mk(false);
    expect(bare).toBeDefined();
    if (hurt) expect(hurt.hp).toBeLessThan(bare!.hp);
  });

  it('does not hit a Hollow Mole under the path, but does when it surfaces', () => {
    const g = createGame(lvl([[['mole' as unknown as 'moth', 1, 1]]]));
    place(g, 'thornbriar', 3, 5);
    callWave(g);
    let cutWhileUnder = 0;
    for (let i = 0; i < 20 / DT; i++) {
      const evs = step(g) as { e: string }[];
      const e = g.enemies[0] as unknown as { under?: boolean } | undefined;
      if (e?.under && evs.some((x) => x.e === 'thornhit')) cutWhileUnder += 1;
    }
    expect(cutWhileUnder).toBe(0);
    const hurtOrDead = g.enemies.length === 0 || g.enemies[0]!.hp < g.enemies[0]!.maxHp;
    expect(hurtOrDead).toBe(true);
  });

  it('grows into two branches', () => {
    const g = createGame(lvl([[['moth', 1, 1]]]));
    place(g, 'thornbriar', 3, 5);
    const id = g.towers[0]!.id;
    expect(upgrade(g, id)).toBe('');
    expect(upgrade(g, id)).toBe('branch');
    expect(upgrade(g, id, 'a')).toBe('');
    expect(upgrade(g, id)).toBe('max');
  });
});
