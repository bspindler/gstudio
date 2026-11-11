// Hal's Hyperline robots, built on the game's own engine: a search bot that proves a course can be
// cleared, and a seeded casual player whose deaths show where the difficulty curve bites.
import { createCourse, type Course } from '../../../../games/hyperline/lib/course.js';
import { mulberry32 } from '../../../../games/hyperline/lib/rng.js';
import { createRunner, step, type Runner } from '../../../../games/hyperline/lib/sim.js';
import { sectorAt, STEP } from '../../../../games/hyperline/lib/world.js';

/** Max states explored per clearable() call. */
export const SEARCH_BUDGET = 2_000_000;

/**
 * A search bot. From every grounded frame it may jump or wait. Holding (jumping on the landing
 * frame) is allowed; otherwise it decides only every 8th frame (15 Hz), so a course that needs a
 * frame-perfect tap fails. If the bot reaches the target distance, a human can too.
 * Returns 'unknown' when it explores more than `budget` states without an answer.
 */
export function clearable(c: Course, until: number, budget: number = SEARCH_BUDGET): boolean | 'unknown' {
  const seen = new Set<string>();
  const clone = (r: Runner): Runner => ({ ...r });
  const advance = (r: Runner, jump: boolean): Runner | null => {
    step(r, c, jump);
    while (!r.dead && !r.grounded && r.x < until) step(r, c, false);
    if (r.dead) return null;
    r.landed = true;
    return r;
  };
  const stack: Runner[] = [createRunner()];
  let explored = 0;
  while (stack.length) {
    const r = stack.pop()!;
    if (r.x >= until) return true;
    const key = `${r.steps}|${r.y.toFixed(2)}|${r.flip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (++explored > budget) return 'unknown';
    if (r.landed || r.steps % 8 === 0) {
      const j = advance({ ...clone(r), landed: false }, true);
      if (j) stack.push(j);
    }
    const w = { ...clone(r), landed: false };
    step(w, c, false);
    if (!w.dead) {
      if (!w.grounded) { const a = advance(w, false); if (a) stack.push(a); }
      else stack.push(w);
    }
  }
  return false;
}

/** The casual player: looks `look` seconds ahead and, with probability `slip`, reacts too late. */
// Pinned by measurement (see the 1b task-2 report): look 0.35 dies in sector 0 at every slip, so
// look is 0.2; slip is the smallest of {0.05, 0.1, 0.15, 0.2, 0.3} whose median death sector over
// seeds 1..40 is in 2..6.
export const HYPERLINE_CASUAL = { slip: 0.05, look: 0.2 };

export type CasualRun = { dist: number; sector: number; cause: string; jumps: number };

/**
 * Below the track with normal gravity, nothing can hold the runner again (the sim only supports
 * from prevY >= -0.12), so the fall is already certain even though 'fall' registers ~0.3 s later.
 */
const doomed = (r: Runner): boolean => r.dead !== '' || (!r.flip && r.y < -0.12);

/** True if the runner is doomed within `frames` steps, jumping (or not) on the first one. */
function diesWithin(r: Runner, c: Course, jump: boolean, frames: number): boolean {
  const s = { ...r };
  step(s, c, jump);
  for (let i = 1; i < frames && !doomed(s); i++) step(s, c, false);
  return doomed(s);
}

/**
 * One seeded casual run of createCourse(seed) to `until`. The lookahead shares the course objects:
 * stepping sets per-object flags (done, mc, got, miss) but those only drive events, never a death,
 * so sharing cannot change the outcome.
 */
export function casualRun(seed: number, until: number, casual: { slip: number; look: number } = HYPERLINE_CASUAL): CasualRun {
  const c = createCourse(seed);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const frames = Math.round(casual.look / STEP);
  const r = createRunner();
  let jumps = 0, wasGrounded = true;
  while (!r.dead && r.x < until) {
    const landed = r.grounded && !wasGrounded;
    let jump = false;
    // Jump if waiting dies and jumping doesn't; if both die, jump; otherwise wait. That is:
    // jump exactly when waiting dies, so the jump-now lookahead never changes the choice.
    if (r.grounded && (landed || r.steps % 8 === 0) && rng() >= casual.slip) jump = diesWithin(r, c, false, frames);
    wasGrounded = r.grounded;
    if (step(r, c, jump).some((e) => e.t === 'jump')) jumps++;
  }
  // Crossing `until` counts as finishing, even if that same step also hit something.
  if (r.x >= until) return { dist: until, sector: sectorAt(Math.max(0, until - 1)), cause: '', jumps };
  return { dist: r.x, sector: sectorAt(r.x), cause: r.dead, jumps };
}
