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
};

/** Seconds between first seeing an enemy and the first shot at it. */
export const REACT = 0.25;
/** Standard deviation of the aim error, in radians. */
export const AIM_ERR = 0.04;
/** Decisions per second; the runner steps 4 x 1/60 s per decision. */
export const DECIDE_HZ = 15;

const TARGET_RADIUS = 0.35; // tiles; the angular radius a shot must land inside to be fired
const SCATTER_RANGE = 4;
const MAX_TURN = 0.3; // radians per decision
const HEAL_BELOW = 50;
const STUCK_DIST = 0.3, STUCK_SECS = 2, STRAFE_SECS = 0.5, EPS = 1e-6;

export type BotMemory = {
  seen: Record<number, number>;           // enemy index -> sim time it came into sight
  opened: Record<string, true>;           // door cells opened so far ("x,y")
  scatter: boolean;                       // has been seen holding the scatter cannon
  ref: { x: number; y: number; t: number } | null; // stuck detector reference
  strafeUntil: number; strafeDir: -1 | 1;
};
export const createMemory = (): BotMemory =>
  ({ seen: {}, opened: {}, scatter: false, ref: null, strafeUntil: -1, strafeDir: 1 });

/** Standard normal from a uniform source (Box-Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const at = (map: string[], x: number, y: number): string => map[y]?.[x] ?? '#';
const isDoor = (c: string): boolean => c === 'D' || c === 'K';
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, m: number): number => Math.max(-m, Math.min(m, x));

/** Grid march from a to b; walls and still-closed doors block. */
function clear(map: string[], mem: BotMemory, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
  for (let i = 1; i < n; i++) {
    const x = Math.floor(ax + ((bx - ax) * i) / n), y = Math.floor(ay + ((by - ay) * i) / n);
    const c = at(map, x, y);
    if (WALLS.includes(c) || (isDoor(c) && !mem.opened[`${x},${y}`])) return false;
  }
  return true;
}

function findCells(map: string[], ch: string): Cell[] {
  const out: Cell[] = [];
  map.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push([x, y]); }));
  return out;
}

export function decide(state: GearholdState, map: string[], mem: BotMemory, rng: () => number): GearholdInput {
  const { p, time } = state;
  const out: GearholdInput = { fwd: 0, str: 0, turn: 0, pitch: 0, fire: false };
  if (p.weapon === 1) mem.scatter = true;

  // Doors the player has walked up to are open (locked ones only with the key).
  map.forEach((row, y) => [...row].forEach((c, x) => {
    if (isDoor(c) && Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) < 1.6 && (c === 'D' || p.key)) mem.opened[`${x},${y}`] = true;
  }));

  // Targets: living, non-prop enemies in line of sight. Track when each came into sight.
  let target: { i: number; d: number; bearing: number } | null = null;
  const visible = new Set<number>();
  state.enemies.forEach((e, i) => {
    if (e.dead || e.prop || !clear(map, mem, p.x, p.y, e.x, e.y)) return;
    visible.add(i);
    if (mem.seen[i] === undefined) mem.seen[i] = time;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (!target || d < target.d) target = { i, d, bearing: Math.atan2(e.y - p.y, e.x - p.x) };
  });
  for (const k of Object.keys(mem.seen)) if (!visible.has(Number(k))) delete mem.seen[Number(k)];

  const wantWeapon = (mem.scatter && p.shells > 0 && target && (target as { d: number }).d < SCATTER_RANGE) ? 1 : 0;
  if (target) {
    const t = target as { i: number; d: number; bearing: number };
    const err = gaussian(rng) * AIM_ERR;
    out.turn = clamp(wrap(t.bearing + err - p.a), MAX_TURN);
    const residual = Math.abs(wrap(t.bearing - (p.a + out.turn)));
    const ready = time - mem.seen[t.i]! >= REACT - EPS;
    out.fire = ready && residual < Math.atan2(TARGET_RADIUS, Math.max(t.d, 0.1));
    if (p.weapon !== wantWeapon) out.weapon = wantWeapon;
    mem.ref = null; // standing and fighting is not being stuck
    return out;
  }
  if (p.weapon !== wantWeapon && !(p.weapon === 1 && p.shells <= 0)) out.weapon = wantWeapon;

  // Stuck detector: 0.3 tiles in 2 s, else strafe randomly for 0.5 s.
  if (time < mem.strafeUntil) { out.str = mem.strafeDir; return out; }
  if (!mem.ref || Math.hypot(p.x - mem.ref.x, p.y - mem.ref.y) >= STUCK_DIST) mem.ref = { x: p.x, y: p.y, t: time };
  else if (time - mem.ref.t >= STUCK_SECS - EPS) {
    mem.strafeDir = rng() < 0.5 ? -1 : 1;
    mem.strafeUntil = time + STRAFE_SECS;
    mem.ref = null;
    out.str = mem.strafeDir;
    return out;
  }

  const goal = goalFor(state, map, mem);
  if (goal) {
    const diff = wrap(Math.atan2(goal.y - p.y, goal.x - p.x) - p.a);
    out.turn = clamp(diff, MAX_TURN);
    out.fwd = Math.abs(diff) < 0.7 ? 1 : 0;
  }
  return out;
}

function goalFor(state: GearholdState, map: string[], mem: BotMemory): { x: number; y: number } | null {
  const { p, items } = state;
  const from: Cell = [Math.floor(p.x), Math.floor(p.y)];
  const step = (r: Cell[] | null, final: { x: number; y: number }): { x: number; y: number } | null => {
    if (!r) return null;
    return r.length > 1 ? { x: r[1]![0] + 0.5, y: r[1]![1] + 0.5 } : final;
  };
  const itemGoal = (kind: string): { x: number; y: number } | null => {
    const cells: Cell[] = items.filter((i) => i.kind === kind).map((i) => [Math.floor(i.x), Math.floor(i.y)]);
    if (!cells.length) return null;
    const r = routePath(map, from, (x, y) => cells.some(([gx, gy]) => gx === x && gy === y), p.key);
    const here = items.find((i) => i.kind === kind && Math.floor(i.x) === from[0] && Math.floor(i.y) === from[1]);
    return step(r, here ? { x: here.x, y: here.y } : { x: p.x, y: p.y });
  };

  const exits = findCells(map, 'X');
  const nextToExit = (x: number, y: number): boolean =>
    !WALLS.includes(at(map, x, y)) && exits.some(([ex, ey]) => Math.abs(ex - x) + Math.abs(ey - y) === 1);

  // Key first, when the exit can't be reached without it.
  if (!p.key && findCells(map, 'K').length > 0 && !routePath(map, from, nextToExit, false)) {
    const g = itemGoal('k');
    if (g) return g;
    const kc = findCells(map, 'k');
    if (kc.length) {
      const r = routePath(map, from, (x, y) => kc.some(([gx, gy]) => gx === x && gy === y), false);
      const g2 = step(r, { x: kc[0]![0] + 0.5, y: kc[0]![1] + 0.5 });
      if (g2) return g2;
    }
  }
  if (p.hp < HEAL_BELOW) { const g = itemGoal('h'); if (g) return g; }
  if (mem.scatter && p.shells <= 0) { const g = itemGoal('a'); if (g) return g; }

  const r = routePath(map, from, nextToExit, p.key);
  if (!r) return null;
  const ex = exits.find(([x, y]) => Math.abs(x - from[0]) + Math.abs(y - from[1]) === 1) ?? exits[0];
  return step(r, ex ? { x: ex[0] + 0.5, y: ex[1] + 0.5 } : { x: p.x, y: p.y });
}
