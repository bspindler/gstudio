import { describe, expect, it } from 'vitest';

import { LEVELS } from '../../../games/lanternkeep/lib/levels.js';
import {
  BREAK_SECONDS, COLS, DT, EARLY_GOLD_PER_SECOND, ENEMIES, ROWS, TOWERS, TOWER_ORDER,
  callWave, canBuild, canCallWave, createGame, pathCells, place, pointAt, buildPath, sell, starsFor, step, upgrade,
  type Game, type Group, type Level,
} from '../../../games/lanternkeep/lib/sim.js';
import { play } from './lanternkeep-bot.js';

// A straight test lane down column 4, lantern at the bottom.
function lane(waves: Group[][], extra: Partial<Level> = {}): Level {
  return { name: 't', intro: '', lives: 20, gold: 500, towers: [...TOWER_ORDER], paths: [[[4, -1], [4, 12]]], waves, ...extra };
}
function run(g: Game, seconds: number) {
  const ev = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ev.push(...step(g));
  return ev;
}

describe('lanternkeep: paths', () => {
  it('measures length and walks along waypoints', () => {
    const p = buildPath([[0, 0], [3, 0], [3, 2]]);
    expect(p.len).toBe(5);
    expect(pointAt(p, 4)).toEqual({ x: 3.5, y: 1.5 });
    expect(pointAt(p, 99)).toEqual({ x: 3.5, y: 2.5 });
  });

  it('lists only in-grid path cells, without repeating corners', () => {
    expect(pathCells([[4, -1], [4, 1], [6, 1]])).toEqual([[4, 0], [4, 1], [5, 1], [6, 1]]);
  });
});

describe('lanternkeep: building', () => {
  it('blocks path tiles, occupied tiles and the edge', () => {
    const g = createGame(lane([[['moth', 1, 1]]]));
    expect(canBuild(g, 4, 5)).toBe(false);
    expect(canBuild(g, 3, 5)).toBe(true);
    expect(canBuild(g, COLS, 0)).toBe(false);
    expect(place(g, 'glowcap', 3, 5)).toBe('');
    expect(canBuild(g, 3, 5)).toBe(false);
    expect(place(g, 'glowcap', 3, 5)).toBe('blocked');
  });

  it('charges gold, refuses when short, and refuses locked towers', () => {
    const g = createGame(lane([[['moth', 1, 1]]], { gold: 60, towers: ['glowcap'] }));
    expect(place(g, 'frost', 3, 3)).toBe('locked');
    expect(place(g, 'glowcap', 3, 3)).toBe('');
    expect(g.gold).toBe(10);
    expect(place(g, 'glowcap', 5, 3)).toBe('gold');
  });

  it('upgrades up to the third tier', () => {
    const g = createGame(lane([[['moth', 1, 1]]], { gold: 1000 }));
    place(g, 'glowcap', 3, 3);
    const id = g.towers[0]!.id;
    expect(upgrade(g, id)).toBe('');
    expect(upgrade(g, id)).toBe('');
    expect(upgrade(g, id)).toBe('max');
    expect(g.towers[0]!.spent).toBe(50 + 60 + 110);
  });

  it('refunds in full before the first wave, then 70%', () => {
    const g = createGame(lane([[['moth', 1, 1]], [['moth', 1, 1]]], { gold: 200 }));
    place(g, 'glowcap', 3, 3);
    expect(sell(g, g.towers[0]!.id)).toBe(50);
    expect(g.gold).toBe(200);
    place(g, 'glowcap', 3, 3);
    callWave(g);
    expect(sell(g, g.towers[0]!.id)).toBe(35);
  });
});

describe('lanternkeep: waves and the lantern', () => {
  it('does nothing until the first wave is called', () => {
    const g = createGame(lane([[['moth', 3, 1]]]));
    run(g, 5);
    expect(g.enemies).toHaveLength(0);
    expect(g.t).toBe(0);
  });

  it('spawns a wave over time and loses lives when enemies reach the lantern', () => {
    const g = createGame(lane([[['moth', 3, 1]]]));
    callWave(g);
    const ev = run(g, 40);
    expect(ev.filter((e) => e.e === 'leak')).toHaveLength(3);
    expect(g.lives).toBe(17);
    expect(g.phase).toBe('won');
  });

  it('a boss costs five lives, and the game is lost at zero', () => {
    const g = createGame(lane([[['toad', 4, 1]]], { lives: 10 }));
    callWave(g);
    run(g, 60);
    expect(g.lives).toBe(0);
    expect(g.phase).toBe('lost');
  });

  it('starts a break after a wave spawns, and calling early pays the seconds left', () => {
    const g = createGame(lane([[['moth', 1, 1]], [['moth', 1, 1]]]));
    callWave(g);
    expect(canCallWave(g)).toBe(false);
    run(g, 0.2);
    expect(g.countdown).not.toBeNull();
    expect(canCallWave(g)).toBe(true);
    const gold = g.gold;
    const left = g.countdown!;
    expect(callWave(g)).toBe(Math.ceil(left) * EARLY_GOLD_PER_SECOND);
    expect(g.gold).toBe(gold + Math.ceil(left) * EARLY_GOLD_PER_SECOND);
    expect(canCallWave(g)).toBe(false);
  });

  it('starts the next wave on its own when the break runs out', () => {
    const g = createGame(lane([[['moth', 1, 1]], [['moth', 1, 1]]]));
    callWave(g);
    const ev = run(g, BREAK_SECONDS + 1);
    expect(ev).toContainEqual({ e: 'wave', n: 2 });
    expect(g.waveIndex).toBe(1);
  });

  it('gives three stars for a near-perfect defence, fewer as lives drop', () => {
    const g = createGame(lane([[['moth', 1, 1]]]));
    expect(starsFor(g)).toBe(3);
    g.lives = 17;
    expect(starsFor(g)).toBe(2);
    g.lives = 4;
    expect(starsFor(g)).toBe(1);
  });
});

describe('lanternkeep: towers', () => {
  it('a glowcap kills moths that walk past it and pays their reward', () => {
    const g = createGame(lane([[['moth', 2, 2]]], { gold: 50 }));
    place(g, 'glowcap', 3, 4);
    callWave(g);
    const ev = run(g, 30);
    expect(ev.filter((e) => e.e === 'kill')).toHaveLength(2);
    expect(g.gold).toBe(2 * ENEMIES.moth.reward);
    expect(g.lives).toBe(20);
  });

  it('armour reduces small hits, but the sunspire pierces it', () => {
    const a = createGame(lane([[['beetle', 1, 1]]]));
    place(a, 'glowcap', 3, 1);
    callWave(a);
    run(a, 1.2);
    const glowHit = a.enemies[0]!.maxHp - a.enemies[0]!.hp;
    expect(glowHit % (TOWERS.glowcap.tiers[0]!.dmg - ENEMIES.beetle.armor)).toBe(0);

    const b = createGame(lane([[['beetle', 1, 1]]]));
    place(b, 'sunspire', 3, 1);
    callWave(b);
    run(b, 1.2);
    expect(b.enemies[0]!.maxHp - b.enemies[0]!.hp).toBe(TOWERS.sunspire.tiers[0]!.dmg);
  });

  it('frost slows moths but not wisps', () => {
    const g = createGame(lane([[['moth', 1, 1], ['wisp', 1, 1]]]));
    place(g, 'frost', 3, 2);
    callWave(g);
    run(g, 2);
    const moth = g.enemies.find((e) => e.type === 'moth')!;
    const wisp = g.enemies.find((e) => e.type === 'wisp')!;
    expect(moth.slow).toBeGreaterThan(0);
    expect(wisp.slow).toBe(0);
  });

  it('ember splash hurts every enemy in the burst', () => {
    const g = createGame(lane([[['firefly', 1, 1], ['firefly', 1, 1, 0.05]]], { towers: ['ember'] }));
    place(g, 'ember', 3, 1);
    callWave(g);
    const ev = run(g, 1.5);
    expect(ev.filter((e) => e.e === 'kill').length).toBe(2);
  });

  it('is deterministic', () => {
    const a = play(LEVELS[5]!);
    const b = play(LEVELS[5]!);
    expect(a).toEqual(b);
  });
});

describe('lanternkeep: levels', () => {
  it.each(LEVELS.map((l, i) => [i + 1, l] as const))('level %i is well formed', (_n, level) => {
    const end = level.paths[0]![level.paths[0]!.length - 1]!;
    for (const p of level.paths) {
      expect(p[p.length - 1]).toEqual(end);
      const [c0, r0] = p[0]!;
      expect(c0 < 0 || c0 >= COLS || r0 < 0 || r0 >= ROWS, 'starts off the board').toBe(true);
      for (let i = 1; i < p.length; i++) expect(p[i]![0] === p[i - 1]![0] || p[i]![1] === p[i - 1]![1], 'axis-aligned').toBe(true);
      const cells = pathCells(p).map(([c, r]) => `${c},${r}`);
      expect(new Set(cells).size, 'a path never crosses itself').toBe(cells.length);
    }
    for (const w of level.waves) for (const [type] of w) expect(Object.keys(ENEMIES)).toContain(type);
    for (const t of level.towers) expect(TOWER_ORDER).toContain(t);
    expect(createGame(level).level.gold).toBeGreaterThanOrEqual(Math.min(...level.towers.map((t) => TOWERS[t].tiers[0]!.cost)));
  });

  it('unlocks towers in order and never takes one away', () => {
    for (let i = 1; i < LEVELS.length; i++) for (const t of LEVELS[i - 1]!.towers) expect(LEVELS[i]!.towers).toContain(t);
  });

  it.each(LEVELS.map((l, i) => [i + 1, l] as const))('level %i: a sensible player wins, doing nothing loses', (_n, level) => {
    // Players adapt, so "sensible" is the best of a few styles: spread wide, or a few towers upgraded.
    const styles = [{}, { maxTowers: 4 }, { maxTowers: 6 }, { maxTowers: 8 }].map((o) => play(level, o));
    expect(styles.some((r) => r.won)).toBe(true);
    expect(play(level, { maxTowers: 0 }).won).toBe(false);
  });

  it.each(LEVELS.slice(1).map((l, i) => [i + 2, l] as const))('level %i: two towers and no upgrades is not enough', (_n, level) => {
    expect(play(level, { maxTowers: 2, upgrades: false }).won).toBe(false);
  });
});
