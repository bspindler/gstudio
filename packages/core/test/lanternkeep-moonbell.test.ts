import { describe, expect, it } from 'vitest';
import * as sim from '../../../games/lanternkeep/lib/sim.js';
import {
  DT, TOWERS, TOWER_ORDER, callWave, createGame, place, step, upgrade,
  type Game, type Group, type Level,
} from '../../../games/lanternkeep/lib/sim.js';
import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';

// sim.d.ts predates Moonbell, so read it loosely.
const TOWERS_ANY = TOWERS as unknown as Record<string, { kind: string; tiers: { rate: number; stunFor: number }[]; branches: Record<'a' | 'b', { dmg: number; stunFor: number }> }>;
const CHIME = sim as unknown as { CHIME_BOSS_FACTOR: number; CHIME_REST: number };

function lvl(waves: Group[][], extra: Partial<Level> = {}): Level {
  return { name: 't', intro: '', lives: 20, gold: 5000, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves, ...extra };
}
const run = (g: Game, secs: number) => { const all = []; for (let i = 0; i < secs / DT; i++) all.push(...step(g)); return all; };
const chimes = (evs: { e: string }[]) => evs.filter((e) => e.e === 'chime');

describe('Moonbell', () => {
  it('is the fifth plant and is a slow, soft chime', () => {
    expect(TOWER_ORDER).toHaveLength(5);
    const def = TOWERS_ANY.moonbell!;
    expect(def.kind).toBe('chime');
    expect(def.tiers[0]!.rate).toBeLessThan(0.5);
    for (const s of [...def.tiers, def.branches.a, def.branches.b]) expect(s.stunFor).toBeGreaterThan(0);
  });

  it('unlocks from night 6 and in Night Watch, not earlier', () => {
    const first = LEVELS.findIndex((l) => (l.towers as string[]).includes('moonbell'));
    expect(first).toBe(5);
    for (const l of LEVELS.slice(first)) expect(l.towers).toContain('moonbell');
  });

  it('stills every creature in range and emits a chime event', () => {
    const g = createGame(lvl([[['moth', 3, 0.2]]]));
    expect(place(g, 'moonbell', 3, 2)).toBe('');
    callWave(g);
    const evs = run(g, 4);
    expect(chimes(evs).length).toBeGreaterThan(0);
    const stalled = createGame(lvl([[['moth', 3, 0.2]]]));
    callWave(stalled);
    run(stalled, 4);
    const sum = (x: Game) => x.enemies.reduce((a, e) => a + e.d, 0);
    expect(sum(g)).toBeLessThan(sum(stalled));
  });

  it('does not stun a creature that is still resting from the last chime', () => {
    const g = createGame(lvl([[['beetle', 1, 1]]]));
    place(g, 'moonbell', 3, 2);
    place(g, 'moonbell', 5, 2);
    callWave(g);
    let stunStarts = 0;
    let prev = 0;
    for (let i = 0; i < 20 / DT; i++) {
      step(g);
      const e = g.enemies[0];
      if (!e) break;
      const s = e.stunLeft;
      if (s > prev + 1e-9) stunStarts += 1;
      prev = s;
    }
    // the second bell never re-stuns during the rest window, so stuns stay spaced apart
    expect(CHIME.CHIME_REST).toBeGreaterThan(0);
    expect(stunStarts).toBeLessThanOrEqual(Math.ceil(20 / (TOWERS_ANY.moonbell!.tiers[0]!.stunFor + CHIME.CHIME_REST)) + 1);
  });

  it('stuns bosses for half as long', () => {
    const t = TOWERS_ANY.moonbell!.tiers[0]!.stunFor;
    const g = createGame(lvl([[['toad', 1, 1]]]));
    place(g, 'moonbell', 3, 2);
    callWave(g);
    let peak = 0;
    for (let i = 0; i < 12 / DT; i++) { step(g); peak = Math.max(peak, g.enemies[0]?.stunLeft ?? 0); }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(t * CHIME.CHIME_BOSS_FACTOR + 1e-9);
  });

  it('grows into two branches and the Tollbell hurts', () => {
    const g = createGame(lvl([[['moth', 1, 1]]]));
    place(g, 'moonbell', 3, 2);
    const id = g.towers[0]!.id;
    expect(upgrade(g, id)).toBe('');
    expect(upgrade(g, id)).toBe('branch');
    expect(upgrade(g, id, 'b')).toBe('');
    expect(TOWERS_ANY.moonbell!.branches.b.dmg).toBeGreaterThan(TOWERS_ANY.moonbell!.branches.a.dmg);
    expect(upgrade(g, id)).toBe('max');
  });

  it('does nothing when nothing is in range', () => {
    const g = createGame(lvl([[['moth', 1, 1]]]));
    place(g, 'moonbell', 0, 12);
    callWave(g);
    expect(chimes(run(g, 1))).toHaveLength(0);
  });
});
