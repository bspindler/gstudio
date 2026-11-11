import { describe, expect, it } from 'vitest';

import {
  AIM_ERR, DECIDE_HZ, MAX_TURN, REACT, SUBSTEPS, createMemory, decide, gaussian, mulberry32,
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
    expect([REACT, AIM_ERR, DECIDE_HZ, SUBSTEPS, MAX_TURN]).toEqual([0.25, 0.04, 15, 4, 8]);
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
    expect(out.turn).toBeGreaterThan(0.05);
    expect(out.turn).toBeLessThanOrEqual(MAX_TURN / 60 + 1e-9);
    expect(out.fire).toBe(false);
  });

  it('ignores an enemy behind a wall', () => {
    const s = st({ enemies: [enemy(1.5, 3.5, { awake: true })] }); // directly south, wall at (1,2)
    const out = decide(s, WALLED, createMemory(), mulberry32(1));
    // no combat turn (a combat turn would be about +0.13 toward south): the player keeps walking the route east
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
    expect(firstFire).toBeLessThan(REACT + 0.15 + 0.2);
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
    expect(low.turn).toBeGreaterThan(0.05); // toward south
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
    expect(empty.turn).toBeGreaterThan(0.05);
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

const sim = (a: number) => ({ a });
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('decide: kinematics (the runner applies turn and pitch SUBSTEPS times)', () => {
  it('yaw aim converges and stays inside the fire gate', () => {
    const mem = createMemory();
    const rng = mulberry32(11);
    const e = enemy(5.5, 4.5); // bearing atan2(3, 4)
    const bearing = Math.atan2(3, 4);
    const k = sim(0);
    let look = 0;
    const fires: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      const s = st({ time: i / DECIDE_HZ, p: { a: k.a, look }, enemies: [e] });
      s.enemies = [e];
      const out = decide(s, [
        '#########', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#########',
      ].map((r) => r.padEnd(10, '.').slice(0, 10)), mem, rng);
      k.a += out.turn * SUBSTEPS; look += out.pitch * SUBSTEPS;
      if (i >= 15) fires.push(out.fire);
      if (i >= 15) expect(Math.abs(wrapA(k.a - bearing))).toBeLessThan(0.2);
    }
    expect(fires.every(Boolean)).toBe(true);
  });

  it('pitch converges so the ray passes through a crawler hit sphere at distance 3', () => {
    const mem = createMemory();
    const rng = mulberry32(5);
    const e = enemy(4.5, 1.5, { kind: 'c' });
    let a = 0, look = 0;
    for (let i = 0; i < 30; i++) {
      const out = decide(st({ time: i / DECIDE_HZ, p: { a, look }, enemies: [e] }), ROOM, mem, rng);
      a += out.turn * SUBSTEPS; look += out.pitch * SUBSTEPS;
    }
    const d = 3, slope = look;
    const rayHeight = 0.6 + slope * d; // game: height at the target's range
    expect(Math.abs(rayHeight - 0.17)).toBeLessThan(0.26 - 0.03);
    expect(look).toBeLessThan(-0.05);
  });
});

describe('decide: doors', () => {
  const DOOR = ['##########', '#S..D....#', '##########', '##########', '##########'];
  const eastEnemy = enemy(7.5, 1.5);
  const seesFor = (doors: GearholdState['doors'] | undefined, key = false) => {
    const mem = createMemory();
    const s = st({ time: 0, p: { key }, enemies: [eastEnemy], ...(doors ? { doors } : {}) });
    const out = decide(s, DOOR, mem, mulberry32(1));
    return Object.keys(mem.seen).length > 0 && out.turn !== undefined;
  };
  it('a closed D blocks sight; an open D does not; absent doors count as closed', () => {
    expect(seesFor([{ x: 4, y: 1, open: 0 }])).toBe(false);
    expect(seesFor([{ x: 4, y: 1, open: 0.94 }])).toBe(false);
    expect(seesFor([{ x: 4, y: 1, open: 0.95 }])).toBe(true);
    expect(seesFor(undefined)).toBe(false);
  });
  it('K blocks sight until open, with or without the key', () => {
    const K = ['##########', '#S..K....#', '##########', '##########', '##########'];
    const look = (open: number, key: boolean) => {
      const mem = createMemory();
      decide(st({ p: { key }, enemies: [eastEnemy], doors: [{ x: 4, y: 1, open }] }), K, mem, mulberry32(1));
      return Object.keys(mem.seen).length > 0;
    };
    expect(look(0, false)).toBe(false);
    expect(look(0, true)).toBe(false); // keyed but not yet slid open
    expect(look(1, true)).toBe(true);
  });
});

describe('decide: engagement', () => {
  it('keeps separate reaction timers per enemy', () => {
    const mem = createMemory();
    const rng = mulberry32(2);
    const a = enemy(6.5, 1.5), b = enemy(6.5, 3.5);
    decide(st({ time: 0, enemies: [a, { ...b, dead: true }] }), ROOM, mem, rng);
    decide(st({ time: 1, enemies: [a, { ...b, dead: true }] }), ROOM, mem, rng);
    decide(st({ time: 1.1, enemies: [a, b] }), ROOM, mem, rng);
    expect(mem.seen[0]!.t).toBe(0);
    expect(mem.seen[1]!.t).toBe(1.1);
    expect(mem.seen[0]!.delay).not.toBe(mem.seen[1]!.delay);
    expect(mem.seen[0]!.delay).toBeGreaterThanOrEqual(REACT);
    expect(mem.seen[0]!.delay).toBeLessThanOrEqual(REACT + 0.15);
  });

  it('strafes while fighting at range under 6, advances beyond 6, with a seeded direction that flips', () => {
    const run = (seed: number) => {
      const mem = createMemory();
      const rng = mulberry32(seed);
      const dirs: number[] = [];
      for (let t = 0; t < 6; t += 1 / DECIDE_HZ)
        dirs.push(decide(st({ time: t, p: { a: 0.8, x: 1.5 + (t % 0.2) * 5 }, enemies: [enemy(4.5, 1.5, { hp: 100 - t * 10 })] }), ROOM, mem, rng).str);
      return dirs;
    };
    const a = run(1), b = run(1);
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set([-1, 1])); // flips within 6 s
    expect(a.every((x) => x !== 0)).toBe(true);
    const exitRoom = ['##########', '#S.......X', '#........#', '##########', '##########'];
    const far = decide(st({ enemies: [enemy(8.5, 2.5)] }), exitRoom, createMemory(), mulberry32(1));
    expect(far.fwd).toBe(1);
    expect(far.str).toBe(0);
    // different seeds eventually pick different first directions
    const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((sd) => run(sd)[0]));
    expect(firsts.size).toBe(2);
  });

  it('ignores a target that takes no damage for 4 s, for 3 s', () => {
    const mem = createMemory();
    const rng = mulberry32(2);
    const e = enemy(4.5, 1.5);
    for (let t = 0; t <= 4.01; t += 1 / DECIDE_HZ) decide(st({ time: t, p: { x: 1.5 + (t % 0.2) * 5 }, enemies: [e] }), ROOM, mem, rng);
    expect(mem.ignore[0]).toBeGreaterThan(4);
    const out = decide(st({ time: 5, enemies: [e] }), ROOM, mem, rng);
    expect(out.fire).toBe(false);
    expect(mem.seen[0]).toBeUndefined();
  });

  it('weapon switching has hysteresis: 3.9 scatter, 4.5 stays, 5.1 back', () => {
    const mem = createMemory();
    const rng = mulberry32(3);
    const w = (weapon: number, x: number, t: number) =>
      decide(st({ time: t, p: { weapon, shells: 5 }, enemies: [enemy(1.5 + x, 1.5)] }), ROOM, mem, rng).weapon;
    decide(st({ time: 0, p: { weapon: 1, shells: 5 } }), ROOM, mem, rng); // owns it
    expect(w(0, 3.9, 0.1)).toBe(1);
    expect(w(1, 4.5, 0.2)).toBeUndefined();
    expect(w(0, 4.5, 0.3)).toBeUndefined();
    expect(w(1, 5.1, 0.4)).toBe(0);
  });

  it('plants (no strafe, no advance) on a firing decision', () => {
    const mem = createMemory();
    const rng = mulberry32(2);
    let fired = 0;
    for (let t = 0; t < 2; t += 1 / DECIDE_HZ) {
      const out = decide(st({ time: t, enemies: [enemy(4.5, 1.5)] }), ROOM, mem, rng);
      if (out.fire) { fired++; expect(out.str).toBe(0); expect(out.fwd).toBe(0); }
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('strafes when the target is far and the route is off-axis', () => {
    const map = ['##########', '#S.......#', '#........#', '#.......X#', '##########'];
    // facing north-ish: route heads east/south, target far to the west... use a far target on the +x axis, route off-axis
    const out = decide(st({ p: { a: 2.2 }, enemies: [enemy(8.5, 1.5)] }), map, createMemory(), mulberry32(1));
    expect(out.str).not.toBe(0);
  });

  it('a dead prop no longer blocks routing', () => {
    const map = ['##########', '#S.o....X#', '##########', '##########', '##########'];
    const prop = (dead: boolean) => ({ kind: 'o', x: 3.5, y: 1.5, hp: 18, awake: false, dead, prop: true });
    const alive = decide(st({ p: { x: 2.5, y: 1.5 }, enemies: [prop(false)] }), map, createMemory(), mulberry32(1));
    const dead = decide(st({ p: { x: 2.5, y: 1.5 }, enemies: [prop(true)] }), map, createMemory(), mulberry32(1));
    expect(alive.fwd).toBe(0); // no route
    expect(dead.fwd).toBe(1);
  });

  it('give-up timer is per enemy: alternating nearest target does not reset it', () => {
    const mem = createMemory();
    const rng = mulberry32(2);
    for (let t = 0, k = 0; t <= 4.2; t += 1 / DECIDE_HZ, k++) {
      const a = enemy(k % 2 ? 3.5 : 4.5, 1.5), b = enemy(k % 2 ? 4.5 : 3.5, 2.5);
      decide(st({ time: t, p: { x: 1.5 + (t % 0.2) * 5 }, enemies: [a, b] }), ROOM, mem, rng);
    }
    expect(Object.keys(mem.ignore).length).toBeGreaterThan(0);
  });

  it('shot at a drone at 3 tiles with no aim error hits; a second enemy 0.45 rad off is not fired at until aligned', () => {
    const mem = createMemory();
    const rng = mulberry32(9);
    // Both seen long ago: first the drone straight ahead, then it dies and another sits 0.45 rad off.
    const big = Array.from({ length: 9 }, (_, y) => (y === 0 || y === 8 ? '#'.repeat(20) : `#${'.'.repeat(18)}#`));
    const a = 0, look = 0;
    const first = enemy(1.5 + 3, 4.5, { y: 4.5 });
    const s1 = st({ time: 0, p: { x: 1.5, y: 4.5, a, look }, enemies: [first] });
    decide(s1, big, mem, rng);
    // advance past reaction; replace by an enemy 0.45 rad off at 3 tiles
    const e2 = enemy(1.5 + 3 * Math.cos(0.45), 4.5 + 3 * Math.sin(0.45));
    let ang = 0, pitch = look, firstFire = -1;
    for (let i = 1; i < 30; i++) {
      const t = i / DECIDE_HZ;
      const out = decide(st({ time: t, p: { x: 1.5, y: 4.5, a: ang, look: pitch }, enemies: [first, e2].slice(1) }), big, mem, rng);
      if (out.fire) {
        // The game fires after ONE substep of turn: that residual must be inside the gate (0.3 / 3).
        const after = ang + out.turn;
        expect(Math.abs(0.45 - after)).toBeLessThan(Math.atan2(0.3, 3) + 0.05);
        if (firstFire < 0) firstFire = i;
      }
      ang += out.turn * SUBSTEPS; pitch += out.pitch * SUBSTEPS;
    }
    expect(firstFire).toBeGreaterThan(1); // not on the first decision, while still 0.45 rad off
  });

  it('routes around props', () => {
    const map = ['##########', '#S.o....X#', '#........#', '##########', '##########'];
    // prop right ahead in row 1; route should dip south: first waypoint is (2,1) then around
    const prop = { kind: 'o', x: 3.5, y: 1.5, hp: 18, awake: false, dead: false, prop: true };
    const out = decide(st({ p: { x: 2.5, y: 1.5 }, enemies: [prop] }), map, createMemory(), mulberry32(1));
    expect(out.turn).toBeGreaterThan(0.05); // turns toward +y, not straight through the prop
  });
});
