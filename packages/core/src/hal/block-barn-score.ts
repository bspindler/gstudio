// Scores Block Barn (a toddler game) from a browser run of real taps (scripts/hal/block-barn-play.ts). Five measures,
// each 100 when the barn is healthy: every tap answers at once, nothing is a dead end, every target is palm-sized,
// every letter turns up with its picture and a voice, and nothing flashes or jumps in volume. Fitness is their mean.
import type { ScoreReport } from './types.js';

/** The hook's target kinds today. A kind the scorer has not heard of (new in the game) is measured like any other. */
export type BlockBarnKind = 'block' | 'animal' | 'tower' | 'floor' | 'corner' | (string & {});
export type BlockBarnViewport = '390x844' | '1024x768';
export const BLOCK_BARN_VIEWPORTS: readonly BlockBarnViewport[] = ['390x844', '1024x768'];

/**
 * One real tap. `changed`: the page changed its DOM synchronously while handling this tap's own pointerdown or
 * pointerup (a change made later, by a timer, never counts); `ms`: from the pointerdown to that change (when nothing
 * changed, the time the tap's two dispatches took); `w`/`h`: the tapped target's box in CSS px.
 */
export type BlockBarnRecord = { kind: BlockBarnKind; letter?: string; ms: number; changed: boolean; w: number; h: number; viewport: BlockBarnViewport };
/** One target as the hook listed it before a tap (every target, in every state visited), in CSS px. */
export type BlockBarnTargetSize = { kind: BlockBarnKind; viewport: BlockBarnViewport; w: number; h: number };

/** The toddler phase's gestures (scripts/hal/block-barn-play.ts): one finger, a run of taps, two fingers, a palm, a 1 s press, a cancel. */
export type BlockBarnGestureKind = 'tap' | 'run' | 'two' | 'palm' | 'press' | 'cancel';
/**
 * One toddler gesture. `phase`: 'random' for the seeded random taps, 'combo' for the scripted taps in a state
 * combination (doors open, dusk). `on`: the hook target kind under the first finger ('gap' when none); `state`: the
 * barn's flags as it landed ('door', 'dusk', 'door+dusk' or ''). `responses`: how many times the page answered it
 * (each release, and each extra finger's press, that changed the page; or once, on the first press, when nothing else
 * did). `signature`: what the answer was (the state change, where in the barn it showed, how many sounds started);
 * `feature`: the thing it reached (a state change such as 'name' or 'door', else where it showed). `stuck`: what the
 * gesture left stuck (read from the hook's state and the page).
 */
export type BlockBarnGesture = {
  viewport: BlockBarnViewport; phase: 'random' | 'combo'; gesture: BlockBarnGestureKind; on: string; state: string;
  responses: number; signature: string; feature: string; stuck: string[];
};
/** A cancelled touch is not a tap: it must answer nothing. Every other gesture answers exactly once. */
export const expectedResponses = (g: Pick<BlockBarnGesture, 'gesture'>): number => (g.gesture === 'cancel' ? 0 : 1);

/** Page-level facts from the run. */
export type BlockBarnPage = {
  /** Letters that reached the floor in the bounded alphabet walk. */
  letters: string[];
  /** Letters whose naming tap produced a voice (a recording, a clip or device speech). */
  voiced: string[];
  /** Letters whose animal was drawn when named. */
  pictured: string[];
  /** Animations or transitions of brightness (opacity, colour, filter, shadow) faster than BLOCK_BARN_RULES.flashMs. */
  flashes: number;
  /**
   * Effective Web Audio gains, as products along every path from a sound source to the speakers: `masterGain` is the
   * loudest product of the shared stage (gains that more than one source feeds through); `peakGain` is the loudest
   * moment of everything playing together (each path's full product, summed over the sources sounding at once).
   */
  masterGain: number;
  peakGain: number;
  /** Every target seen before each tap. */
  targets: BlockBarnTargetSize[];
  /** The page navigated away from the barn. */
  leftBarn: boolean;
  /** The toddler phase at each viewport, in order. */
  gestures: BlockBarnGesture[];
};

/**
 * Brian-reviewed limits. 100 ms is "at once" for a tap; 88 CSS px is a toddler's palm; 333 ms per brightness change is
 * at most 3 changes a second (the photosensitivity guideline); the sound caps are today's master level (0.5) and a
 * little over today's loudest sound (0.12), so Hal can polish sounds but never make one jump out.
 */
export const BLOCK_BARN_RULES = { responsiveMs: 100, minTarget: 88, flashMs: 333, masterCap: 0.5, peakCap: 0.15 } as const;
/** The alphabet walk's bound: stack-and-refill steps, two trips round the 26-letter rotation. */
export const BLOCK_BARN_ALPHABET_STEPS = 52;
/** The toddler phase's random taps per viewport (scripts/hal/block-barn-play.ts toddlerPlan): answering ones, cancels on top. */
export const BLOCK_BARN_TODDLER_TAPS = 60;

export type BlockBarnViewStats = { viewport: BlockBarnViewport; taps: number; responsive: number; changed: number; bigTargets: number; kinds: BlockBarnKind[] };

const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
const round2 = (x: number): number => Math.round(x * 100) / 100;
const pct = (num: number, den: number): number => (den === 0 ? 100 : round2((100 * num) / den));

const quick = (r: BlockBarnRecord): boolean => r.changed && r.ms <= BLOCK_BARN_RULES.responsiveMs;
/**
 * Every target for her must be palm-sized. Not counted: the grown-up corner (small and tucked away on purpose) and
 * the floor, which is the bare hay left between things, not a thing; a full barn leaves little of it, as it should.
 */
const forHer = (r: { kind: string }): boolean => r.kind !== 'corner' && r.kind !== 'floor';
const big = (r: { w: number; h: number }): boolean => Math.min(r.w, r.h) >= BLOCK_BARN_RULES.minTarget;

export function scoreBlockBarn(records: BlockBarnRecord[], page: BlockBarnPage): ScoreReport<BlockBarnViewStats> {
  if (records.length === 0) throw new Error('scoreBlockBarn: no tap records');
  const R = BLOCK_BARN_RULES;
  const hardFailures: string[] = [];
  records = records.filter((r, i) => {
    let bad = false;
    for (const k of ['ms', 'w', 'h'] as const)
      if (!Number.isFinite(r[k])) { hardFailures.push(`record ${i} (${r.viewport} ${r.kind}): ${k} is not finite`); bad = true; }
    if (typeof r.kind !== 'string' || !r.kind) { hardFailures.push(`record ${i}: no target kind`); bad = true; }
    if (!BLOCK_BARN_VIEWPORTS.includes(r.viewport)) { hardFailures.push(`record ${i}: unknown viewport "${String(r.viewport)}"`); bad = true; }
    return !bad;
  });
  const targets = (page.targets ?? []).filter((t, i) => {
    let bad = false;
    for (const k of ['w', 'h'] as const) if (!Number.isFinite(t[k])) { hardFailures.push(`target ${i} (${t.viewport} ${t.kind}): ${k} is not finite`); bad = true; }
    if (!BLOCK_BARN_VIEWPORTS.includes(t.viewport)) { hardFailures.push(`target ${i}: unknown viewport "${String(t.viewport)}"`); bad = true; }
    return !bad;
  });
  for (const v of BLOCK_BARN_VIEWPORTS) if (!records.some((r) => r.viewport === v)) hardFailures.push(`no taps at ${v}`);
  for (const v of BLOCK_BARN_VIEWPORTS) if (!targets.some((t) => t.viewport === v)) hardFailures.push(`no targets measured at ${v}`);

  hardFailures.push(...gestureFailures(page.gestures ?? []));

  const levels: BlockBarnViewStats[] = BLOCK_BARN_VIEWPORTS.map((viewport) => {
    const rs = records.filter((r) => r.viewport === viewport), hers = targets.filter((t) => t.viewport === viewport && forHer(t));
    return {
      viewport, taps: rs.length, responsive: pct(rs.filter(quick).length, rs.length), changed: pct(rs.filter((r) => r.changed).length, rs.length),
      bigTargets: pct(hers.filter(big).length, hers.length), kinds: [...new Set([...rs, ...targets.filter((t) => t.viewport === viewport)].map((r) => r.kind))].sort(),
    };
  });

  const hers = targets.filter(forHer);
  const has = (xs: string[]) => new Set(xs);
  const reached = has(page.letters), voiced = has(page.voiced), pictured = has(page.pictured);
  const measures = {
    responsive: pct(records.filter(quick).length, records.length),
    noDeadEnds: page.leftBarn ? 0 : pct(records.filter((r) => r.changed).length, records.length),
    bigTargets: pct(hers.filter(big).length, hers.length),
    alphabet: pct(AZ.filter((l) => reached.has(l) && voiced.has(l) && pictured.has(l)).length, AZ.length),
    calm: (page.flashes > 0 ? 0 : 50) + (page.masterGain <= R.masterCap && page.peakGain <= R.peakCap ? 50 : 0),
  };
  const vals = Object.values(measures);
  return { game: 'block-barn', levels, measures, fitness: round2(vals.reduce((a, b) => a + b, 0) / vals.length), hardFailures };
}

const MAX_GESTURE_FAILURES = 10;
/** Every gesture answers exactly once (a cancel never) and leaves nothing stuck; each viewport ran the toddler phase. */
function gestureFailures(gestures: BlockBarnGesture[]): string[] {
  const out: string[] = [], missing: string[] = [];
  for (const v of BLOCK_BARN_VIEWPORTS) {
    const gs = gestures.filter((g) => g.viewport === v);
    if (!gs.length) { missing.push(`no toddler gestures at ${v}`); continue; }
    gs.forEach((g, i) => {
      const what = `${v} ${g.phase} ${g.gesture} ${i + 1} on ${g.on}${g.state ? ` (${g.state})` : ''}`;
      const want = expectedResponses(g);
      if (g.responses !== want) out.push(`${what}: ${g.responses} response${g.responses === 1 ? '' : 's'}, expected ${want}`);
      if (g.stuck?.length) out.push(`${what}: stuck: ${g.stuck.join('; ')}`);
    });
  }
  const shown = out.slice(0, MAX_GESTURE_FAILURES);
  if (out.length > shown.length) shown.push(`and ${out.length - shown.length} more gesture failures`);
  return [...shown, ...missing];
}
