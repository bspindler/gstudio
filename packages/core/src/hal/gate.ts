// Keep/discard gate: compares score reports from before and after a change.
// Hard failures always discard; they are never traded against score.
import type { Measures, ScoreReport } from './types.js';

export const GATE = { minGain: 0.5, tolerance: 1.0 } as const; // score points

export type GateResult = { keep: boolean; gain: number; reasons: string[] };

export function compareScores(before: ScoreReport | null, after: ScoreReport, target?: string): GateResult {
  if (!before) return { keep: false, gain: 0, reasons: ['no baseline to compare against'] };

  const reasons: string[] = after.hardFailures.map((f) => `hard failure: ${f}`);
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const own = (m: Measures, k: string): number | undefined => (Object.hasOwn(m, k) ? m[k] : undefined);

  if (!finite(after.fitness)) reasons.push(`after fitness is not a finite number: ${String(after.fitness)}`);
  for (const [name, now] of Object.entries(after.measures)) {
    if (!finite(now)) reasons.push(`after measure ${name} is not a finite number: ${String(now)}`);
  }

  const b = target ? own(before.measures, target) : before.fitness;
  const a = target ? own(after.measures, target) : after.fitness;
  let gain = 0;
  if (!finite(b) || !finite(a)) {
    reasons.push(`target ${target ? `measure "${target}"` : 'fitness'} is missing or not finite in a report`);
  } else {
    gain = a - b;
    if (gain < GATE.minGain) reasons.push(`no real gain: ${gain.toFixed(2)} < ${GATE.minGain}`);
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
