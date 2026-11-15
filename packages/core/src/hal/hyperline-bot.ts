// Hal's Hyperline robots, built on the game's own engine: a search bot that proves a course can be
// cleared, and a seeded casual player whose deaths show where the difficulty curve bites.
import { createCourse, lowerBound, type Course } from '../../../../games/hyperline/lib/course.js';
import { mulberry32 } from '../../../../games/hyperline/lib/rng.js';
import { createRunner, step, type Runner } from '../../../../games/hyperline/lib/sim.js';
import { AIR, PS, sectorAt, speedAt, STEP } from '../../../../games/hyperline/lib/world.js';

/**
 * Simulation steps the robots have taken (every call into the game's step()). Tests budget scoring by this count, not
 * by wall-clock time, which varied 30-32 s on CI for the same code (measurement v2, P1.4).
 */
export const work = { steps: 0 };
const stepSim: typeof step = (r, c, jump) => { work.steps++; return step(r, c, jump); };

/** Max states explored per clearable() call. */
export const SEARCH_BUDGET = 2_000_000;

type Found = { ok: boolean | 'unknown'; far: number };

/** One step through the air: from a jump (or a wait that left the ground) to the landing frame. */
function advance(r: Runner, c: Course, until: number, jump: boolean): Runner | null {
  stepSim(r, c, jump);
  while (!r.dead && !r.grounded && r.x < until) stepSim(r, c, false);
  if (r.dead) return null;
  r.landed = true;
  return r;
}

/** The next states from a grounded runner: jumping (only on the 15 Hz grid or a landing), then waiting. */
function children(r: Runner, c: Course, until: number): { jump: Runner | null; wait: Runner | null } {
  let jump: Runner | null = null;
  if (r.landed || r.steps % 8 === 0) jump = advance({ ...r, landed: false }, c, until, true);
  let wait: Runner | null = { ...r, landed: false };
  stepSim(wait, c, false);
  if (wait.dead) wait = null;
  else if (!wait.grounded) wait = advance(wait, c, until, false);
  return { jump, wait };
}

/**
 * Depth-first search from `starts` for any state at x >= until. `far` is the furthest x any live
 * state reached. 'unknown' when more than `budget` distinct states were explored.
 */
function search(starts: Runner[], c: Course, until: number, budget: number): Found {
  const seen = new Set<string>();
  const stack = [...starts];
  let explored = 0, far = -Infinity;
  while (stack.length) {
    const r = stack.pop()!;
    far = Math.max(far, r.x);
    if (r.x >= until) return { ok: true, far };
    const key = `${r.steps}|${r.y.toFixed(2)}|${r.flip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (++explored > budget) return { ok: 'unknown', far };
    const { jump, wait } = children(r, c, until);
    if (jump) stack.push(jump);
    if (wait) stack.push(wait);
  }
  return { ok: false, far };
}

/**
 * A search bot. From every grounded frame it may jump or wait. Holding (jumping on the landing
 * frame) is allowed; otherwise it decides only every 8th frame (15 Hz), so a course that needs a
 * frame-perfect tap fails. If the bot reaches the target distance, a human can too.
 * Returns 'unknown' when it explores more than `budget` states without an answer.
 */
export function clearable(c: Course, until: number, budget: number = SEARCH_BUDGET): boolean | 'unknown' {
  return search([createRunner()], c, until, budget).ok;
}

/**
 * The casual player: it sees `horizon` seconds of track ahead (converted to distance with speedAt) and, for each hazard
 * that would kill it if it did nothing, finds the window of tap frames that clear it (jumpWindow), aims for the middle
 * and taps at middle + lag + N(0, sigma) seconds. `lag` is a reaction delay drawn once per run, uniformly from
 * [0, lag]: some players are consistently a little late. Seeded per run, so a run replays exactly (measurement v2, P2).
 * The old planner tapped on the last safe 15 Hz frame and was near-perfect; 0-33 ms of jitter on that edge dropped the
 * median run from 915 m to 351 m. Aiming at the middle is what a person does, so the noise lands where it should.
 */
export const HYPERLINE_CASUAL = { horizon: 1, sigma: 0.03, lag: 0.03 };
export type CasualParams = { horizon: number; sigma: number; lag: number };

/** States the planner may explore per continuation check; past it ('unknown') the tap counts as NOT clearing. */
export const PLAN_BUDGET = 4000;
/** A tap is a press the game keeps for 0.12 s (index.html press(): G.buf = 0.12): it jumps on any grounded frame in it. */
export const TAP_BUFFER = 15;
/** Coarse scan stride (frames) when looking for a window's edges; each edge is then refined frame by frame. */
const STRIDE = 2;
/** Frames before a death that a tap can clear it from: one jump's air time (AIR) plus a little. */
const SCAN = Math.ceil(AIR / STEP) + 8;
/** After clearing the hazard, a tap must leave a surviving continuation this many seconds past the death point. */
const CONTINUE = 0.5;

/** A hazard's tap window, in frames from now: taps at lo..hi clear it. `p`: the killing object's pattern ('' if untagged). */
export type JumpWindow = { lo: number; hi: number; deathX: number; p: string };
/** One hazard met: its pattern, the window width in ms (0: none found), and where the tap went, ms from the middle. */
export type Met = { p: string; ms: number; off: number };
export type CasualRun = { dist: number; sector: number; cause: string; jumps: number; windows: Met[]; killer: string };

const KILLER: Record<string, string> = { spike: 'spike', block: 'block', fall: 'pit', wall: 'pit', bar: 'bar', gate: 'gate', rail: 'rail' };

/** The pattern (o.p) of the object that killed a dead runner: the last object of the killing kind at or before it. */
export function killerPattern(r: Runner, c: Course): string {
  const t = KILLER[r.dead];
  if (!t) return '';
  const x1 = r.x + PS;
  let p = '';
  for (let i = lowerBound(c.objs, r.x - 30); i < c.objs.length && c.objs[i]!.x <= x1 + 0.1; i++) if (c.objs[i]!.t === t) p = c.objs[i]!.p ?? '';
  return p;
}

/** Tap at `from` (a TAP_BUFFER press), then no input: alive past deathX, with a surviving continuation from there. */
function tapClears(from: Runner, c: Course, deathX: number): boolean {
  const s: Runner = { ...from, landed: false };
  let tapped = false;
  for (let i = 0; s.x < deathX; i++) {
    const ev = stepSim(s, c, !tapped && i < TAP_BUFFER);
    if (s.dead) return false;
    if (!tapped && ev.some((e) => e.t === 'jump')) tapped = true;
  }
  if (!tapped) return false;
  const goal = deathX + speedAt(deathX) * CONTINUE;
  if (!s.grounded && !advance(s, c, goal, false)) return false;
  return search([s], c, goal, PLAN_BUDGET).ok === true;
}

/**
 * The widest run of tap frames 0..traj.length-1 that clear the death at deathX (frame k taps from traj[k]); the later
 * one on a tie. Only the last SCAN frames before the death can clear it: the sim is a function of x alone (x advances
 * the same whether or not the runner jumps), so a jump that lands back on the track before the hazard rejoins the
 * no-input future and dies the same way. A coarse scan (every STRIDE frames) finds the runs, then the chosen run's
 * edges are refined frame by frame. Null when no frame clears it.
 */
function windowIn(traj: Runner[], c: Course, deathX: number): { lo: number; hi: number } | null {
  const ok = (k: number) => tapClears(traj[k]!, c, deathX);
  const n = traj.length;
  let best: { lo: number; hi: number } | null = null, run: { lo: number; hi: number } | null = null;
  for (let k = n - 1; k >= Math.max(0, n - 1 - SCAN); k -= STRIDE) {
    if (ok(k)) { run = run ? { lo: k, hi: run.hi } : { lo: k, hi: k }; if (!best || run.hi - run.lo > best.hi - best.lo) best = run; }
    else run = null;
  }
  if (!best) return null;
  let { lo, hi } = best;
  for (let k = Math.min(n - 1, hi + STRIDE - 1); k > hi; k--) if (ok(k)) { hi = k; break; }
  for (let k = Math.max(0, lo - STRIDE + 1); k < lo; k++) if (ok(k)) { lo = k; break; }
  return { lo, hi };
}

/** Extends a ghost (the no-input future) until it dies or passes goal; traj gets each live state. */
function extendGhost(g: Runner, traj: Runner[], c: Course, goal: number): void {
  while (!g.dead && g.x < goal) { stepSim(g, c, false); if (!g.dead) traj.push({ ...g }); }
}

/**
 * The tap window for the first hazard within `horizon` seconds that kills a runner who does nothing, or null if doing
 * nothing survives. Steps `c` (it sets per-object event flags), so plan on a copy of the course a run uses.
 */
export function jumpWindow(r: Runner, c: Course, horizon: number): JumpWindow | null {
  const g: Runner = { ...r, landed: false }, traj: Runner[] = [{ ...g }];
  extendGhost(g, traj, c, r.x + speedAt(r.x) * horizon);
  if (!g.dead) return null;
  const w = windowIn(traj, c, g.x);
  return w && { ...w, deathX: g.x, p: killerPattern(g, c) };
}

/** A standard normal draw from two uniforms (Box-Muller). */
function gauss(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/**
 * One seeded casual run of createCourse(seed) to `until`. The player plans on its own copy of the course (built from
 * the same seed), so planning never sets the flags the real run's events read (near misses, clears, chips).
 */
export function casualRun(seed: number, until: number, casual: CasualParams = HYPERLINE_CASUAL): CasualRun {
  const c = createCourse(seed), pc = createCourse(seed);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const lag = rng() * casual.lag;
  const r = createRunner();
  const windows: Met[] = [];
  let jumps = 0, traj: Runner[] = [], base = 0, g: Runner | null = null, planned = false, tapAt = -1;
  while (!r.dead && r.x < until) {
    if (!planned) {
      // The ghost runs from the last jump on; with no input the runner follows it exactly, so it only needs extending.
      if (!g) { g = { ...r, landed: false }; traj = [{ ...g }]; base = r.steps; }
      extendGhost(g, traj, pc, r.x + speedAt(r.x) * casual.horizon);
      if (g.dead) {
        planned = true;
        const w = windowIn(traj.slice(r.steps - base), pc, g.x), p = killerPattern(g, pc);
        if (w) {
          const mid = (w.lo + w.hi) / 2, at = Math.max(0, Math.round(mid + (lag + casual.sigma * gauss(rng)) / STEP));
          tapAt = r.steps + at;
          windows.push({ p, ms: (w.hi - w.lo + 1) * STEP * 1000, off: (at - mid) * STEP * 1000 });
        } else windows.push({ p, ms: 0, off: 0 });
      }
    }
    const jumped = stepSim(r, c, tapAt >= 0 && r.steps >= tapAt && r.steps < tapAt + TAP_BUFFER).some((e) => e.t === 'jump');
    if (jumped) jumps++;
    // A jump, or a tap that ran out unused, changes the future: look again from here.
    if (jumped || (tapAt >= 0 && r.steps >= tapAt + TAP_BUFFER)) { planned = false; tapAt = -1; g = null; }
  }
  // Crossing `until` counts as finishing, even if that same step also hit something.
  if (r.x >= until) return { dist: until, sector: sectorAt(Math.max(0, until - 1)), cause: '', jumps, windows, killer: '' };
  return { dist: r.x, sector: sectorAt(r.x), cause: r.dead, jumps, windows, killer: killerPattern(r, c) };
}
