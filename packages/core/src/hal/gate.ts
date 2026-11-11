// Keep/discard gate: compares score reports from before and after a change.
// Hard failures always discard; they are never traded against score.
import type { Measures, ScoreReport } from './types.js';

export const GATE = { minGain: 0.5, tolerance: 1.0 } as const; // score points

export type GateResult = { keep: boolean; gain: number; reasons: string[] };

/**
 * Gate modes. `score`: a gain of at least GATE.minGain on the target measure (or on fitness when there is no target),
 * with nothing else regressing past GATE.tolerance. `polish`: no gain needed; keep unless a measure (or fitness)
 * regresses past GATE.tolerance. Hard failures and non-finite values always discard, in both modes.
 */
export type GateMode = 'score' | 'polish';
export type GateOptions = { mode?: GateMode; target?: string };

/**
 * The third argument is either the legacy target string (or nothing): score mode, as before; or an options object,
 * whose mode defaults to `score` when it names a target and `polish` when it does not.
 */
export function compareScores(before: ScoreReport<unknown> | null, after: ScoreReport<unknown>, opts?: string | GateOptions): GateResult {
  const isOpts = typeof opts === 'object' && opts !== null;
  const o: GateOptions = isOpts ? opts : { target: opts };
  const mode: GateMode = o.mode ?? (isOpts && o.target === undefined ? 'polish' : 'score');
  const target = mode === 'score' ? o.target : undefined;
  if (!before) return { keep: false, gain: 0, reasons: ['no baseline to compare against'] };

  const reasons: string[] = after.hardFailures.map((f) => `hard failure: ${f}`);
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const own = (m: Measures, k: string): number | undefined => (Object.hasOwn(m, k) ? m[k] : undefined);

  if (!finite(after.fitness)) reasons.push(`after fitness is not a finite number: ${String(after.fitness)}`);
  for (const [name, now] of Object.entries(after.measures)) {
    if (!finite(now)) reasons.push(`after measure ${name} is not a finite number: ${String(now)}`);
  }

  let gain = 0;
  if (mode === 'polish') {
    // No gain needed, but fitness counts as a measure: a fall past the tolerance discards.
    if (!finite(before.fitness)) reasons.push(`before fitness is not a finite number: ${String(before.fitness)}`);
    else if (finite(after.fitness)) {
      gain = after.fitness - before.fitness;
      if (-gain > GATE.tolerance) reasons.push(`fitness regressed ${(-gain).toFixed(2)} (> ${GATE.tolerance})`);
    }
  } else {
    const b = target ? own(before.measures, target) : before.fitness;
    const a = target ? own(after.measures, target) : after.fitness;
    if (!finite(b) || !finite(a)) {
      reasons.push(`target ${target ? `measure "${target}"` : 'fitness'} is missing or not finite in a report`);
    } else {
      gain = a - b;
      if (gain < GATE.minGain) reasons.push(`no real gain: ${gain.toFixed(2)} < ${GATE.minGain}`);
    }
  }

  for (const [name, was] of Object.entries(before.measures)) {
    const now = own(after.measures, name);
    if (now === undefined) reasons.push(`${name} missing from the after report (treated as a regression)`);
    else if (finite(was) && finite(now) && was - now > GATE.tolerance) {
      reasons.push(`${name} regressed ${(was - now).toFixed(2)} (> ${GATE.tolerance})`);
    }
  }

  return { keep: reasons.length === 0, gain, reasons };
}
