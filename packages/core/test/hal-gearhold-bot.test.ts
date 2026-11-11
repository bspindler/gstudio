import { describe, expect, it } from 'vitest';

import {
  AIM_ERR, DECIDE_HZ, REACT, createMemory, decide, gaussian, mulberry32,
  type GearholdState,
} from '../src/hal/gearhold-bot.js';

const ROOM = [
  '##########',
  '#S.......#',
  '#........#',
  '#........#',
  '##########',
];
const WALLED = [
  '##########',
  '#S.......X',
  '##.......#',
  '#........#',
  '##########',
];

function st(over: Partial<Omit<GearholdState, 'p'>> & { p?: Partial<GearholdState['p']> } = {}): GearholdState {
  const { p, ...rest } = over;
  return {
    mode: 'play', level: 1, time: 0,
    p: { x: 1.5, y: 1.5, a: 0, look: 0, hp: 100, shells: 0, key: false, weapon: 0, ...p },
    enemies: [], items: [], kills: 0, foes: 0, shotsFired: 0, hits: 0, damageTaken: 0, damageUnseen: 0, result: '',
    ...rest,
  };
}
const enemy = (x: number, y: number, over = {}) => ({ kind: 'd', x, y, hp: 30, awake: true, dead: false, prop: false, ...over });

describe('constants', () => {
  it('pins the brief values', () => {
    expect([REACT, AIM_ERR, DECIDE_HZ]).toEqual([0.25, 0.04, 15]);
  });
  it('gaussian is seeded and roughly standard', () => {
    const a = mulberry32(1), b = mulberry32(1);
    expect(gaussian(a)).toBe(gaussian(b));
    const r = mulberry32(7);
    const xs = Array.from({ length: 4000 }, () => gaussian(r));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.08);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.1);
  });
});

describe('decide: combat', () => {
  it('turns toward a visible enemy', () => {
    const s = st({ enemies: [enemy(1.5, 3.5)] }); // due south (+y), player faces +x
    const out = decide(s, ROOM, createMemory(), mulberry32(1));
    expect(out.turn).toBeGreaterThan(0.2);
    expect(out.fire).toBe(false);
  });

  it('ignores an enemy behind a wall', () => {
    const s = st({ enemies: [enemy(1.5, 3.5, { awake: true })] }); // directly south, wall at (1,2)
    const out = decide(s, WALLED, createMemory(), mulberry32(1));
    // no combat turn (that would be about +0.3 toward south): the player keeps walking the route east
    expect(out.fire).toBe(false);
    expect(Math.abs(out.turn)).toBeLessThan(0.05);
    expect(out.fwd).toBe(1);
  });

  it('waits REACT before firing, then fires when aligned', () => {
    const mem = createMemory();
    const rng = mulberry32(3);
    const e = enemy(6.5, 1.5);
    let firstFire = -1;
    for (let t = 0; t < 2; t += 1 / DECIDE_HZ) {
      const out = decide(st({ time: t, enemies: [e] }), ROOM, mem, rng);
      if (out.fire && firstFire < 0) firstFire = t;
    }
    expect(firstFire).toBeGreaterThanOrEqual(REACT - 1e-9);
    expect(firstFire).toBeLessThan(REACT + 0.5);
  });

  it('does not fire when misaligned even after the delay', () => {
    const mem = createMemory();
    const rng = mulberry32(3);
    const e = enemy(1.5, 3.5);
    decide(st({ time: 0, enemies: [e] }), ROOM, mem, rng);
    const out = decide(st({ time: 1, enemies: [e] }), ROOM, mem, rng); // still facing +x, 90 deg off
    expect(out.fire).toBe(false);
  });

  it('resets the reaction timer after losing sight', () => {
    const mem = createMemory();
    const rng = mulberry32(3);
    const e = enemy(6.5, 1.5);
    decide(st({ time: 0, enemies: [e] }), ROOM, mem, rng);
    decide(st({ time: 1, enemies: [] }), ROOM, mem, rng);
    const out = decide(st({ time: 1.07, enemies: [e] }), ROOM, mem, rng);
    expect(out.fire).toBe(false);
  });

  it('switches to the scatter cannon under 4 tiles when owned', () => {
    const mem = createMemory();
    const rng = mulberry32(3);
    decide(st({ time: 0, p: { weapon: 1, shells: 5 } }), ROOM, mem, rng); // observed owning it
    const far = decide(st({ time: 0.1, p: { weapon: 1, shells: 5 }, enemies: [enemy(7.5, 1.5)] }), ROOM, mem, rng);
    expect(far.weapon).toBe(0);
    const near = decide(st({ time: 0.2, p: { weapon: 0, shells: 5 }, enemies: [enemy(3.5, 1.5)] }), ROOM, mem, rng);
    expect(near.weapon).toBe(1);
  });
});

describe('decide: routing', () => {
  const KEYMAP = [
    '############',
    '#S...#.....#',
    '#....K....X#',
    '#..k.#.....#',
    '############',
  ];
  it('goes to the key first when the exit is locked away', () => {
    const mem = createMemory();
    // key at (3,3), directly south of the player, who faces +x.
    const out = decide(st({ p: { x: 3.5, y: 1.5 }, items: [{ kind: 'k', x: 3.5, y: 3.5 }] }), KEYMAP, mem, mulberry32(1));
    expect(out.turn).toBeGreaterThan(0);
  });
  it('heads for the exit once keyed', () => {
    const out = decide(st({ p: { key: true, y: 2.5, a: 0 } }), KEYMAP, createMemory(), mulberry32(1));
    expect(out.fwd).toBe(1);
    expect(Math.abs(out.turn)).toBeLessThan(0.05);
  });
  it('detours for health under 50 and not above', () => {
    const map = [
      '##########',
      '#S.......X',
      '#........#',
      '#h.......#',
      '##########',
    ];
    const items = [{ kind: 'h', x: 1.5, y: 3.5 }];
    const low = decide(st({ p: { hp: 30 }, items }), map, createMemory(), mulberry32(1));
    const high = decide(st({ p: { hp: 90 }, items }), map, createMemory(), mulberry32(1));
    expect(low.turn).toBeGreaterThan(0.25); // toward south
    expect(Math.abs(high.turn)).toBeLessThan(0.05); // toward the exit, east
  });
  it('detours for shells only when the scatter cannon is owned and empty', () => {
    const map = [
      '##########',
      '#S.......X',
      '#........#',
      '#a.......#',
      '##########',
    ];
    const items = [{ kind: 'a', x: 1.5, y: 3.5 }];
    const mem = createMemory();
    decide(st({ time: 0, p: { weapon: 1, shells: 2 } }), map, mem, mulberry32(1));
    const empty = decide(st({ time: 0.1, p: { weapon: 0, shells: 0 }, items }), map, mem, mulberry32(1));
    expect(empty.turn).toBeGreaterThan(0.25);
    const none = decide(st({ p: { shells: 0 }, items }), map, createMemory(), mulberry32(1));
    expect(Math.abs(none.turn)).toBeLessThan(0.05);
  });
});

describe('decide: unstick and determinism', () => {
  it('strafes after 2 s without moving 0.3 tiles, for 0.5 s', () => {
    const mem = createMemory();
    const rng = mulberry32(5);
    let strafed = -1, ended = -1;
    for (let t = 0; t < 4; t += 1 / DECIDE_HZ) {
      const out = decide(st({ time: t }), ROOM, mem, rng);
      if (out.str !== 0 && strafed < 0) strafed = t;
      if (strafed >= 0 && out.str === 0 && ended < 0) ended = t;
    }
    expect(strafed).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(strafed).toBeLessThan(2.2);
    expect(ended - strafed).toBeGreaterThanOrEqual(0.45);
    expect(ended - strafed).toBeLessThan(0.7);
  });

  it('does not unstick while moving', () => {
    const mem = createMemory();
    const rng = mulberry32(5);
    for (let t = 0, x = 1.5; t < 4; t += 1 / DECIDE_HZ, x += 0.05) {
      const out = decide(st({ time: t, p: { x: 1.5 + (x % 5) } }), ROOM, mem, rng);
      expect(out.str).toBe(0);
    }
  });

  it('same seed and inputs give the same outputs', () => {
    const run = () => {
      const mem = createMemory();
      const rng = mulberry32(42);
      const outs = [];
      for (let t = 0; t < 3; t += 1 / DECIDE_HZ)
        outs.push(decide(st({ time: t, enemies: [enemy(6.5, 2.5)] }), ROOM, mem, rng));
      return outs;
    };
    expect(run()).toEqual(run());
  });
});
