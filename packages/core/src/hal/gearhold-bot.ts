// A pure Gearhold player policy: state snapshot in, controls out. No browser, no clock, no unseeded randomness.
// Combat: aim at the nearest visible enemy after a reaction delay, with Gaussian aim error. Otherwise follow the map route.
import { mulberry32 } from '../../../../games/hyperline/lib/rng.js';
import { WALLS } from '../../../../games/gearhold/levels.js';
import { routePath, type Cell } from './gearhold-walk.js';

export { mulberry32 };

export type GearholdInput = { fwd: -1 | 0 | 1; str: -1 | 0 | 1; turn: number; pitch: number; fire: boolean; weapon?: 0 | 1 };
export type GearholdState = {
  mode: string; level: number; time: number;
  p: { x: number; y: number; a: number; look: number; hp: number; shells: number; key: boolean; weapon: number };
  enemies: { kind: string; x: number; y: number; hp: number; awake: boolean; dead: boolean; prop: boolean }[];
  items: { kind: string; x: number; y: number }[];
  kills: number; foes: number; shotsFired: number; hits: number; damageTaken: number; damageUnseen: number;
  result: '' | 'win' | 'dead';
  /** Doors (D and K) with slide fraction open in [0,1]. When absent, doors are treated as closed. */
  doors?: { x: number; y: number; open: number }[];
};

/** Seconds between first seeing an enemy and the first shot at it (plus a seeded 0..0.15 s jitter). */
export const REACT = 0.25;
/** Standard deviation of the aim offset (radians yaw; slope units for pitch). Resampled every AIM_RESAMPLE s. */
export const AIM_ERR = 0.04;
/** Decisions per second; the runner steps SUBSTEPS x 1/60 s per decision. */
export const DECIDE_HZ = 15;
/** The runner applies each decision's input for this many 1/60 s steps; `turn` and `pitch` are PER SUBSTEP. */
export const SUBSTEPS = 4;
/** Max turn rate, rad/s; per substep that is MAX_TURN / 60. */
export const MAX_TURN = 8;

/**
 * Nominal target radius (tiles) for the fire gate. The gate uses the bot's believed aim (the steering target,
 * without the aim offset), so real hits depend on the game's real hit spheres and `feel` can see hitbox changes.
 * It should stay near the in-game radii (0.21 to 0.4); the in-game sphere sets the true hit rate, not this gate.
 */
export const GATE_RADIUS = 0.3;
const EYE = 0.6; // the game's eye height (index.html EYE)
const REACT_JITTER = 0.15, AIM_RESAMPLE = 0.5;
const SCATTER_IN = 4, SCATTER_OUT = 5;
const FAR = 6; // beyond this, keep advancing along the route while engaging
const STALL_SECS = 4, IGNORE_SECS = 3;
const HEAL_BELOW = 50;
const STUCK_DIST = 0.3, STUCK_SECS = 2, STRAFE_SECS = 0.5, EPS = 1e-6;

/** The game's hit volumes by kind: aim point height and sphere radius of the main body (index.html volumes()). */
const AIM_POINT: Record<string, { h: number; r: number }> = {
  d: { h: 0.64, r: 0.25 }, c: { h: 0.17, r: 0.26 }, b: { h: 0.8, r: 0.4 },
};
const DEFAULT_AIM = { h: 0.28, r: 0.21 };

export type BotMemory = {
  seen: Record<number, { t: number; delay: number }>; // enemy index -> first-seen time and its seeded reaction delay
  offset: Record<number, { yaw: number; pitch: number; until: number }>; // per-target aim offsets
  ignore: Record<number, number>;          // enemy index -> ignored until this sim time
  engage: { i: number; hp: number; since: number } | null;
  scatter: boolean;                        // has been seen holding the scatter cannon
  ref: { x: number; y: number; t: number } | null; // stuck detector reference
  strafeUntil: number; strafeDir: -1 | 1;  // unstick strafe
  dodgeDir: -1 | 1; dodgeFlip: number;     // combat strafe, flips every 1-2 s
};
export const createMemory = (): BotMemory => ({
  seen: {}, offset: {}, ignore: {}, engage: null, scatter: false, ref: null,
  strafeUntil: -1, strafeDir: 1, dodgeDir: 1, dodgeFlip: -1,
});

/** Standard normal from a uniform source (Box-Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const at = (map: string[], x: number, y: number): string => map[y]?.[x] ?? '#';
const isDoor = (c: string): boolean => c === 'D' || c === 'K';
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, m: number): number => Math.max(-m, Math.min(m, x));

/** Grid march from a to b; walls and doors that are not open (>= 0.95) block. */
function clear(map: string[], state: GearholdState, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
  for (let i = 1; i < n; i++) {
    const x = Math.floor(ax + ((bx - ax) * i) / n), y = Math.floor(ay + ((by - ay) * i) / n);
    const c = at(map, x, y);
    if (WALLS.includes(c)) return false;
    if (isDoor(c)) {
      const d = state.doors?.find((q) => Math.floor(q.x) === x && Math.floor(q.y) === y);
      if (!d || d.open < 0.95) return false;
    }
  }
  return true;
}

function findCells(map: string[], ch: string): Cell[] {
  const out: Cell[] = [];
  map.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push([x, y]); }));
  return out;
}

type Pt = { x: number; y: number };

/** Next point to steer toward: key first if needed, health/ammo detours, else the exit. */
function goalFor(state: GearholdState, map: string[], mem: BotMemory): Pt | null {
  const { p, items } = state;
  const from: Cell = [Math.floor(p.x), Math.floor(p.y)];
  const nav = map.map((r) => r.replace(/o/g, '#')); // props block movement
  const step = (r: Cell[] | null, final: Pt): Pt | null => {
    if (!r) return null;
    return r.length > 1 ? { x: r[1]![0] + 0.5, y: r[1]![1] + 0.5 } : final;
  };
  const itemGoal = (kind: string): Pt | null => {
    const cells: Cell[] = items.filter((i) => i.kind === kind).map((i) => [Math.floor(i.x), Math.floor(i.y)]);
    if (!cells.length) return null;
    const r = routePath(nav, from, (x, y) => cells.some(([gx, gy]) => gx === x && gy === y), p.key);
    const here = items.find((i) => i.kind === kind && Math.floor(i.x) === from[0] && Math.floor(i.y) === from[1]);
    return step(r, here ? { x: here.x, y: here.y } : { x: p.x, y: p.y });
  };

  const exits = findCells(map, 'X');
  const nextToExit = (x: number, y: number): boolean =>
    !WALLS.includes(at(nav, x, y)) && exits.some(([ex, ey]) => Math.abs(ex - x) + Math.abs(ey - y) === 1);

  if (!p.key && findCells(map, 'K').length > 0 && !routePath(nav, from, nextToExit, false)) {
    const g = itemGoal('k');
    if (g) return g;
    const kc = findCells(map, 'k');
    if (kc.length) {
      const r = routePath(nav, from, (x, y) => kc.some(([gx, gy]) => gx === x && gy === y), false);
      const g2 = step(r, { x: kc[0]![0] + 0.5, y: kc[0]![1] + 0.5 });
      if (g2) return g2;
    }
  }
  if (p.hp < HEAL_BELOW) { const g = itemGoal('h'); if (g) return g; }
  if (mem.scatter && p.shells <= 0) { const g = itemGoal('a'); if (g) return g; }

  const r = routePath(nav, from, nextToExit, p.key);
  if (!r) return null;
  const ex = exits.find(([x, y]) => Math.abs(x - from[0]) + Math.abs(y - from[1]) === 1) ?? exits[0];
  return step(r, ex ? { x: ex[0] + 0.5, y: ex[1] + 0.5 } : { x: p.x, y: p.y });
}

export function decide(state: GearholdState, map: string[], mem: BotMemory, rng: () => number): GearholdInput {
  const { p, time } = state;
  const out: GearholdInput = { fwd: 0, str: 0, turn: 0, pitch: 0, fire: false };
  const perSub = MAX_TURN / 60;
  const sub = (x: number): number => clamp(x / SUBSTEPS, perSub);
  if (p.weapon === 1) mem.scatter = true;

  // Targets: living, non-prop, non-ignored enemies in line of sight. Track when each came into sight.
  let target: { i: number; d: number; bearing: number } | null = null;
  const visible = new Set<number>();
  state.enemies.forEach((e, i) => {
    if (e.dead || e.prop || (mem.ignore[i] ?? -1) > time || !clear(map, state, p.x, p.y, e.x, e.y)) return;
    visible.add(i);
    if (mem.seen[i] === undefined) mem.seen[i] = { t: time, delay: REACT + rng() * REACT_JITTER };
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (!target || d < target.d) target = { i, d, bearing: Math.atan2(e.y - p.y, e.x - p.x) };
  });
  for (const k of Object.keys(mem.seen)) if (!visible.has(Number(k))) { delete mem.seen[Number(k)]; delete mem.offset[Number(k)]; }

  const goal = goalFor(state, map, mem);
  const goalDiff = goal ? wrap(Math.atan2(goal.y - p.y, goal.x - p.x) - p.a) : 0;

  const tg = target as { i: number; d: number; bearing: number } | null;
  if (tg) {
    const e = state.enemies[tg.i]!;
    // Weapon with hysteresis: scatter under 4 tiles, back to the hand cannon past 5.
    const wantWeapon: 0 | 1 = mem.scatter && p.shells > 0 && (tg.d < SCATTER_IN || (p.weapon === 1 && tg.d <= SCATTER_OUT)) ? 1 : 0;
    if (p.weapon !== wantWeapon) out.weapon = wantWeapon;

    // Aim offsets: resampled every 0.5 s; they live in the aim, so the real hitbox decides hits.
    let off = mem.offset[tg.i];
    if (!off || time >= off.until) off = mem.offset[tg.i] = { yaw: gaussian(rng) * AIM_ERR, pitch: gaussian(rng) * AIM_ERR, until: time + AIM_RESAMPLE };
    const ap = AIM_POINT[e.kind] ?? DEFAULT_AIM;
    const wantYaw = wrap(tg.bearing + off.yaw - p.a);
    const wantPitch = (ap.h - EYE) / Math.max(tg.d, 0.1) + off.pitch - p.look;
    out.turn = sub(wantYaw);
    out.pitch = sub(wantPitch);
    // Believed aim after this decision's SUBSTEPS applications, measured against the steering target (no offset).
    const resYaw = Math.abs(wrap(tg.bearing + off.yaw - (p.a + out.turn * SUBSTEPS)));
    const resPitch = Math.abs(wantPitch - out.pitch * SUBSTEPS);
    const gate = Math.atan2(GATE_RADIUS, Math.max(tg.d, 0.1));
    out.fire = time - mem.seen[tg.i]!.t >= mem.seen[tg.i]!.delay - EPS && resYaw < gate && resPitch < gate;

    // Engagement stall: no damage in 4 s means ignore the target for 3 s.
    if (!mem.engage || mem.engage.i !== tg.i || e.hp < mem.engage.hp) mem.engage = { i: tg.i, hp: e.hp, since: time };
    else if (time - mem.engage.since >= STALL_SECS) {
      mem.ignore[tg.i] = time + IGNORE_SECS;
      mem.engage = null;
    }

    // Keep moving: advance along the route when far, else strafe (seeded direction, flips every 1-2 s).
    if (tg.d > FAR) out.fwd = goal && Math.abs(goalDiff) < 0.7 ? 1 : 0;
    else {
      if (time >= mem.dodgeFlip) {
        mem.dodgeDir = mem.dodgeFlip < 0 ? (rng() < 0.5 ? -1 : 1) : (mem.dodgeDir === 1 ? -1 : 1);
        mem.dodgeFlip = time + 1 + rng();
      }
      out.str = mem.dodgeDir;
    }
  } else {
    mem.engage = null;
    const wantWeapon: 0 | 1 = p.weapon === 1 && p.shells > 0 ? 1 : 0;
    if (p.weapon !== wantWeapon && !(p.weapon === 1 && p.shells <= 0)) out.weapon = wantWeapon;
    if (goal) {
      out.turn = sub(goalDiff);
      out.fwd = Math.abs(goalDiff) < 0.7 ? 1 : 0;
    }
    out.pitch = sub(-p.look); // level the view
  }

  // Stuck detector (runs during engagement too): 0.3 tiles in 2 s, else strafe randomly for 0.5 s.
  if (time < mem.strafeUntil) { out.str = mem.strafeDir; out.fwd = 0; return out; }
  if (!mem.ref || Math.hypot(p.x - mem.ref.x, p.y - mem.ref.y) >= STUCK_DIST) mem.ref = { x: p.x, y: p.y, t: time };
  else if (time - mem.ref.t >= STUCK_SECS - EPS) {
    mem.strafeDir = rng() < 0.5 ? -1 : 1;
    mem.strafeUntil = time + STRAFE_SECS;
    mem.ref = null;
    out.str = mem.strafeDir; out.fwd = 0;
  }
  return out;
}
