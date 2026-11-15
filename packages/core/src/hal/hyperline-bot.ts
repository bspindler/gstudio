// Hal's Hyperline robots, built on the game's own engine: a search bot that proves a course can be
// cleared, and a seeded casual player whose deaths show where the difficulty curve bites.
import { createCourse, type Course } from '../../../../games/hyperline/lib/course.js';
import { mulberry32 } from '../../../../games/hyperline/lib/rng.js';
import { createRunner, step, type Runner } from '../../../../games/hyperline/lib/sim.js';
import { sectorAt, speedAt } from '../../../../games/hyperline/lib/world.js';

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
 * The casual player: a planner that sees `horizon` seconds of track ahead (converted to distance
 * with speedAt at the decision point) and, with probability `slip`, skips a decision (reacts late).
 * Pinned by measurement (1b task-2 report, horizon x slip table): horizon 1 s; slip is the smallest
 * of {0.05, 0.1, 0.15, 0.2, 0.3} whose seeds 1..40 have a median death sector in 2..6 and >= 10%
 * of runs reaching sector 5.
 */
export const HYPERLINE_CASUAL = { slip: 0.05, horizon: 1 };

/** States the planner may explore per branch per decision; past it ('unknown') the branch counts as NOT surviving. */
export const PLAN_BUDGET = 4000;

export type CasualRun = { dist: number; sector: number; cause: string; jumps: number };

/**
 * Waiting through the next decision: the runner steps with no input until it has passed one frame
 * where it could have decided (grounded, on a landing or the 15 Hz grid), then (if airborne) to its
 * landing. A casual plan must survive one missed decision, since any decision may slip.
 */
function waitOutNextDecision(r: Runner, c: Course, goal: number): Runner | null {
  const w: Runner = { ...r, landed: false };
  for (let skipped = false; ;) {
    const air = !w.grounded;
    stepSim(w, c, false);
    if (w.dead) return null;
    if (skipped || w.x >= goal) break;
    skipped = w.grounded && (air || w.steps % 8 === 0);
  }
  if (!w.grounded) return advance(w, c, goal, false);
  return w;
}

/**
 * Wait if waiting (through the next decision) has any surviving continuation to x + H; otherwise
 * jump if jumping now does; if neither, take the branch that got further. H is `horizon` seconds
 * converted to distance with speedAt at the decision point. Both use the search bot's grid and
 * memo, bounded by PLAN_BUDGET; a branch whose search runs out of budget ('unknown') is treated as not surviving.
 */
function decide(r: Runner, c: Course, horizon: number): boolean {
  const goal = r.x + speedAt(r.x) * horizon;
  const wait = waitOutNextDecision(r, c, goal);
  const w = wait ? search([wait], c, goal, PLAN_BUDGET) : { ok: false, far: r.x };
  if (w.ok === true) return false; // 'unknown' (budget exhausted) is not proof of survival
  const jump = advance({ ...r, landed: false }, c, goal, true);
  if (!jump) return false;
  const j = search([jump], c, goal, PLAN_BUDGET);
  return j.ok === true || j.far > w.far;
}

/**
 * One seeded casual run of createCourse(seed) to `until`. Planning shares the course objects:
 * stepping sets per-object flags (done, mc, got, miss) but those only drive events, never a death,
 * so sharing cannot change the outcome.
 */
export function casualRun(seed: number, until: number, casual: { slip: number; horizon: number } = HYPERLINE_CASUAL): CasualRun {
  const c = createCourse(seed);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const r = createRunner();
  let jumps = 0;
  while (!r.dead && r.x < until) {
    let jump = false;
    if (r.grounded && (r.landed || r.steps % 8 === 0) && rng() >= casual.slip) jump = decide(r, c, casual.horizon);
    r.landed = false;
    const wasGrounded = r.grounded;
    if (stepSim(r, c, jump).some((e) => e.t === 'jump')) jumps++;
    if (r.grounded && !wasGrounded) r.landed = true;
  }
  // Crossing `until` counts as finishing, even if that same step also hit something.
  if (r.x >= until) return { dist: until, sector: sectorAt(Math.max(0, until - 1)), cause: '', jumps };
  return { dist: r.x, sector: sectorAt(r.x), cause: r.dead, jumps };
}
