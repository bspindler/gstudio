// Scores Block Barn (a toddler game) from a browser run of real taps (scripts/hal/block-barn-play.ts). Five measures,
// each 100 when the barn is healthy: every tap answers at once, nothing is a dead end, every target is palm-sized,
// every letter turns up with its picture and a voice, and nothing flashes or jumps in volume. Fitness is their mean.
import type { ScoreReport } from './types.js';

export type BlockBarnKind = 'block' | 'animal' | 'tower' | 'floor' | 'corner';
export type BlockBarnViewport = '390x844' | '1024x768';
export const BLOCK_BARN_VIEWPORTS: readonly BlockBarnViewport[] = ['390x844', '1024x768'];

/**
 * One real tap. `ms`: from the pointerup to the first change the page made to its DOM (the runner gives up waiting at
 * 1 s); `changed`: the page changed something in answer; `w`/`h`: the tapped target's box in CSS px.
 */
export type BlockBarnRecord = { kind: BlockBarnKind; letter?: string; ms: number; changed: boolean; w: number; h: number; viewport: BlockBarnViewport };

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
  /** Highest gain the sound effects' master stage reached, and the highest any single sound's own gain reached. */
  masterGain: number;
  peakGain: number;
  /** The page navigated away from the barn. */
  leftBarn: boolean;
};

/**
 * Brian-reviewed limits. 100 ms is "at once" for a tap; 88 CSS px is a toddler's palm; 333 ms per brightness change is
 * at most 3 changes a second (the photosensitivity guideline); the sound caps are today's master level (0.5) and a
 * little over today's loudest sound (0.12), so Hal can polish sounds but never make one jump out.
 */
export const BLOCK_BARN_RULES = { responsiveMs: 100, minTarget: 88, flashMs: 333, masterCap: 0.5, peakCap: 0.15 } as const;
/** The alphabet walk's bound: stack-and-refill steps, two trips round the 26-letter rotation. */
export const BLOCK_BARN_ALPHABET_STEPS = 52;

export type BlockBarnViewStats = { viewport: BlockBarnViewport; taps: number; responsive: number; changed: number; bigTargets: number; kinds: BlockBarnKind[] };

const KINDS: readonly string[] = ['block', 'animal', 'tower', 'floor', 'corner'];
const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
const round2 = (x: number): number => Math.round(x * 100) / 100;
const pct = (num: number, den: number): number => (den === 0 ? 100 : round2((100 * num) / den));

const quick = (r: BlockBarnRecord): boolean => r.changed && r.ms <= BLOCK_BARN_RULES.responsiveMs;
/** The grown-up corner is small and tucked away on purpose; every target for her must be palm-sized. */
const forHer = (r: BlockBarnRecord): boolean => r.kind !== 'corner';
const big = (r: BlockBarnRecord): boolean => Math.min(r.w, r.h) >= BLOCK_BARN_RULES.minTarget;

export function scoreBlockBarn(records: BlockBarnRecord[], page: BlockBarnPage): ScoreReport<BlockBarnViewStats> {
  if (records.length === 0) throw new Error('scoreBlockBarn: no tap records');
  const R = BLOCK_BARN_RULES;
  const hardFailures: string[] = [];
  records = records.filter((r, i) => {
    let bad = false;
    for (const k of ['ms', 'w', 'h'] as const)
      if (!Number.isFinite(r[k])) { hardFailures.push(`record ${i} (${r.viewport} ${r.kind}): ${k} is not finite`); bad = true; }
    if (!KINDS.includes(r.kind)) { hardFailures.push(`record ${i}: unknown target kind "${String(r.kind)}"`); bad = true; }
    if (!BLOCK_BARN_VIEWPORTS.includes(r.viewport)) { hardFailures.push(`record ${i}: unknown viewport "${String(r.viewport)}"`); bad = true; }
    return !bad;
  });
  for (const v of BLOCK_BARN_VIEWPORTS) if (!records.some((r) => r.viewport === v)) hardFailures.push(`no taps at ${v}`);

  const levels: BlockBarnViewStats[] = BLOCK_BARN_VIEWPORTS.map((viewport) => {
    const rs = records.filter((r) => r.viewport === viewport), hers = rs.filter(forHer);
    return {
      viewport, taps: rs.length, responsive: pct(rs.filter(quick).length, rs.length), changed: pct(rs.filter((r) => r.changed).length, rs.length),
      bigTargets: pct(hers.filter(big).length, hers.length), kinds: KINDS.filter((k) => rs.some((r) => r.kind === k)) as BlockBarnKind[],
    };
  });

  const hers = records.filter(forHer);
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
