// Keep/discard gate: compares score reports from before and after a change.
// Hard failures always discard; they are never traded against score.
import type { ScoreReport } from './types.js';

export const GATE = { minGain: 0.5, tolerance: 1.0 } as const; // score points

export type GateResult = { keep: boolean; gain: number; reasons: string[] };

export function compareScores(before: ScoreReport | null, after: ScoreReport, target?: string): GateResult {
  if (!before) return { keep: false, gain: 0, reasons: ['no baseline to compare against'] };

  const reasons: string[] = after.hardFailures.map((f) => `hard failure: ${f}`);

  const b = target ? before.measures[target] : before.fitness;
  const a = target ? after.measures[target] : after.fitness;
  let gain = 0;
  if (b === undefined || a === undefined) {
    reasons.push(`target measure "${target}" missing from a report`);
  } else {
    gain = a - b;
    if (gain < GATE.minGain) reasons.push(`no real gain: ${gain.toFixed(2)} < ${GATE.minGain}`);
  }

  for (const [name, was] of Object.entries(before.measures)) {
    const now = after.measures[name];
    if (now !== undefined && was - now > GATE.tolerance) {
      reasons.push(`${name} regressed ${(was - now).toFixed(2)} (> ${GATE.tolerance})`);
    }
  }

  return { keep: reasons.length === 0, gain, reasons };
}
