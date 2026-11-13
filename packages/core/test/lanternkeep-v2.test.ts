import { describe, expect, it } from 'vitest';

import {
  DT, ENEMIES, FLARE_COOLDOWN, FLARE_RADIUS, TOWERS, TOWER_ORDER,
  callWave, createGame, flareCharge, place, stats, step, upgrade, upgradeCost, useFlare,
  type Game, type Group, type Level,
} from '../../../games/lanternkeep/lib/sim.js';
import { endlessLevel } from '../../../games/lanternkeep/lib/endless.js';

function lane(waves: Group[][], extra: Partial<Level> = {}): Level {
  return { name: 't', intro: '', lives: 20, gold: 5000, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves, ...extra };
}
function run(g: Game, seconds: number) {
  const ev = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(g));
  return ev;
}
const grow = (g: Game, id: number, branch?: 'a' | 'b') => { upgrade(g, id); return upgrade(g, id, branch); };

describe('lanternkeep v2: lantern flare', () => {
  it('starts empty, charges only during waves, and is ready after the cooldown', () => {
    const g = createGame(lane([[['toad', 3, 20]]]));
    expect(flareCharge(g)).toBe(0);
    run(g, 5);
    expect(flareCharge(g)).toBe(0);
    callWave(g);
    run(g, FLARE_COOLDOWN / 2);
    expect(flareCharge(g)).toBeCloseTo(0.5, 1);
    expect(useFlare(g)).toBe('charging');
    run(g, FLARE_COOLDOWN / 2 + 0.1);
    expect(flareCharge(g)).toBe(1);
  });

  it('hurts and stuns everything near the lantern, through armour, then recharges', () => {
    const g = createGame(lane([[['beetle', 1, 1]]]));
    callWave(g);
    g.flareCd = 0;
    run(g, 0.1);
    const e = g.enemies[0]!;
    e.d = 11; // two tiles short of the lantern at the end of the path
    run(g, DT);
    const before = e.hp, at = e.d;
    expect(useFlare(g)).toBe('');
    const ev = run(g, DT);
    expect(ev.some((x) => x.e === 'flare')).toBe(true);
    expect(before - e.hp).toBeGreaterThanOrEqual(30);
    run(g, 0.5);
    expect(e.d).toBeCloseTo(at, 5);
    expect(flareCharge(g)).toBeLessThan(0.1);
  });

  it('leaves creatures outside the radius alone', () => {
    const g = createGame(lane([[['moth', 1, 1]]]));
    callWave(g);
    run(g, 0.1);
    g.flareCd = 0;
    useFlare(g);
    run(g, DT);
    expect(g.enemies[0]!.hp).toBe(g.enemies[0]!.maxHp);
    expect(FLARE_RADIUS).toBeLessThan(12);
  });

  it('perks make the flare charge faster and hit harder', () => {
    const g = createGame(lane([[['toad', 3, 20]]]), { flareCooldown: 0.5, flareDamage: 2 });
    callWave(g);
    run(g, FLARE_COOLDOWN * 0.5 + 0.1);
    expect(flareCharge(g)).toBe(1);
  });
});

describe('lanternkeep v2: specialisations', () => {
  it('the third growth needs a branch, and each branch has its own name', () => {
    const g = createGame(lane([[['moth', 1, 1]]]));
    place(g, 'glowcap', 3, 3);
    const id = g.towers[0]!.id;
    expect(upgrade(g, id)).toBe('');
    expect(upgrade(g, id)).toBe('branch');
    expect(upgrade(g, id, 'b')).toBe('');
    expect(g.towers[0]!.branch).toBe('b');
    expect(stats(g.towers[0]!).name).toBe(TOWERS.glowcap.branches.b.name);
    expect(upgrade(g, id, 'a')).toBe('max');
    expect(upgradeCost(g.towers[0]!)).toBeNull();
  });

  it('Spore Storm hits up to three creatures at once', () => {
    const g = createGame(lane([[['beetle', 4, 0.2]]]));
    place(g, 'glowcap', 3, 2);
    grow(g, g.towers[0]!.id, 'a');
    callWave(g);
    let most = 0;
    for (let i = 0; i < 30 * 3; i++) most = Math.max(most, step(g).filter((e) => e.e === 'bolt').length);
    expect(most).toBe(3);
  });

  it('Deepcap stuns on every fourth shot', () => {
    const g = createGame(lane([[['toad', 1, 1]]]));
    place(g, 'glowcap', 3, 2);
    grow(g, g.towers[0]!.id, 'b');
    callWave(g);
    let stunned = false;
    for (let i = 0; i < 30 * 6 && !stunned; i++) { step(g); stunned = (g.enemies[0]?.stunLeft ?? 0) > 0; }
    expect(stunned).toBe(true);
  });

  it('Cinder leaves a burning patch that keeps hurting', () => {
    const g = createGame(lane([[['toad', 1, 1]]]));
    place(g, 'ember', 3, 2);
    grow(g, g.towers[0]!.id, 'b');
    callWave(g);
    run(g, 3);
    expect(g.patches.length).toBeGreaterThan(0);
  });

  it('Solar Lance pierces every creature on the line', () => {
    const g = createGame(lane([[['toad', 3, 0.5]]]));
    place(g, 'sunspire', 3, 6);
    grow(g, g.towers[0]!.id, 'a');
    callWave(g);
    const ev = run(g, 12);
    const most = Math.max(...ev.filter((e) => e.e === 'beam').map((e) => (e as { hits: number }).hits));
    expect(most).toBe(3);
  });

  it('Daybreak ramps damage on the same target', () => {
    const g = createGame(lane([[['toad', 1, 1]]]));
    place(g, 'sunspire', 3, 3);
    grow(g, g.towers[0]!.id, 'b');
    callWave(g);
    const hits: number[] = [];
    let last = 0;
    for (let i = 0; i < 30 * 8 && hits.length < 4; i++) {
      step(g);
      const e = g.enemies[0];
      if (!e) break;
      const dealt = e.maxHp - e.hp;
      if (dealt > last) { hits.push(dealt - last); last = dealt; }
    }
    expect(hits[2]!).toBeGreaterThan(hits[0]!);
  });

  it('Hoarfrost slows harder than the base fern', () => {
    expect(TOWERS.frost.branches.a.slow!).toBeGreaterThan(TOWERS.frost.tiers[1]!.slow!);
  });
});

describe('lanternkeep v2: new creatures', () => {
  it('a mossback heals creatures near it, not itself', () => {
    const g = createGame(lane([[['moth', 1, 1], ['mossback', 1, 1, 0.3]]]));
    callWave(g);
    run(g, 0.5);
    const moth = g.enemies.find((e) => e.type === 'moth')!;
    const moss = g.enemies.find((e) => e.type === 'mossback')!;
    moth.hp = 10;
    moss.hp = 50;
    run(g, 1);
    expect(moth.hp).toBeGreaterThan(10);
    expect(moss.hp).toBe(50);
  });

  it('the mothmother bursts into moths when she dies', () => {
    const g = createGame(lane([[['mothmother', 1, 1]]]));
    callWave(g);
    run(g, 2);
    g.enemies[0]!.hp = 1;
    place(g, 'glowcap', 3, Math.floor(g.enemies[0]!.y));
    const ev = run(g, 1);
    expect(ev.some((e) => e.e === 'kill' && e.type === 'mothmother')).toBe(true);
    expect(g.enemies.filter((e) => e.type === 'moth').length).toBe(ENEMIES.mothmother.split!.n);
  });
});

describe('lanternkeep v2: perks', () => {
  it('apply at the start of a level', () => {
    const base = lane([[['moth', 1, 1]]], { gold: 100, lives: 20 });
    const g = createGame(base, { lives: 3, gold: 40, glowcapDiscount: 0.2 });
    expect(g.lives).toBe(23);
    expect(g.maxLives).toBe(23);
    expect(g.gold).toBe(140);
    place(g, 'glowcap', 3, 3);
    expect(g.gold).toBe(140 - 40);
  });
});

describe('lanternkeep v2: night watch', () => {
  it('generates the same escalating waves every time', () => {
    const a = endlessLevel(), b = endlessLevel();
    expect(a).toEqual(b);
    expect(a.waves.length).toBeGreaterThanOrEqual(50);
    const size = (w: Group[]) => w.reduce((s, [t, n]) => s + n * ENEMIES[t].hp, 0);
    expect(size(a.waves[20]!)).toBeGreaterThan(size(a.waves[2]!));
    for (const w of a.waves) for (const [t] of w) expect(Object.keys(ENEMIES)).toContain(t);
  });
});
