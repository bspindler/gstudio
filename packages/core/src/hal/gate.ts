// Keep/discard gate: compares score reports from before and after a change.
// Hard failures always discard; they are never traded against score.
import type { Measures, ScoreReport } from './types.js';

/**
 * Score points. Scores and measures run 0-100, and 100 means every band is healthy (`ceiling`).
 * `soft`: measures whose drop discards only when the ticket targets them; otherwise the drop is a note on the change.
 * Tension is soft by operator decision D1 (2026-11-15): as a veto it threw out real balance gains (Lanternkeep HAL-059,
 * +4.6 fitness, for tension -4.2) and visual-only changes that reshuffled the bot's luck.
 */
export const GATE = { minGain: 0.5, tolerance: 1.0, ceiling: 100, soft: ['tension'] as readonly string[] } as const;

/**
 * The gate's band for one measure: the flat value (GATE.tolerance or GATE.minGain), widened to two standard errors of
 * the difference when the reports carry noise (operator decision D2, 2026-11-15). Fixed seed sets moved scores more
 * than the flat 0.5 / 1.0 (Gearhold tension 35.0 / 20.9 / 21.9 on three seed blocks), so keeps and discards near the
 * line were luck. No noise on either side: the flat value, as before.
 */
export function noiseBand(flat: number, seBefore: number | undefined, seAfter: number | undefined): number {
  const b = Number.isFinite(seBefore) ? seBefore! : 0, a = Number.isFinite(seAfter) ? seAfter! : 0;
  return Math.max(flat, 2 * Math.sqrt(b * b + a * a));
}

/** A level of a report that scores each level 0-100 on its own (gearhold-play, measurement v2 P3). */
type ScoredLevel = { level: number; scores: Measures; noise?: Measures };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
function scoredLevels(r: ScoreReport<unknown>): ScoredLevel[] | null {
  const ls = r.levels as unknown[];
  return Array.isArray(ls) && ls.length > 0 && ls.every((l) => isObj(l) && Number.isFinite(l.level) && isObj(l.scores))
    ? (ls as ScoredLevel[]) : null;
}
const round2 = (x: number): number => Math.round(x * 100) / 100;
const fmtNum = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/**
 * The new-level path (measurement v2 P3). When the after report has every level of the before report plus new ones,
 * and both score each level on its own (`levels[i].scores`, whose means are the measures of the same names and whose
 * measures' mean is fitness), a new level must not move the averages either way. Instead: every old level's scores
 * must each hold within their noise band, and every new level's scores must be within their noise band of 100 (in
 * band). The rest of the gate then sees the after report restricted to the old levels. Measures that are not
 * per-level scores (tension) stay as reported. Null when the path does not apply: the plain gate, as before.
 */
function newLevelPath(before: ScoreReport<unknown>, after: ScoreReport<unknown>): { reasons: string[]; after: ScoreReport<unknown> } | null {
  const b = scoredLevels(before), a = scoredLevels(after);
  if (!b || !a) return null;
  const old = new Set(b.map((l) => l.level));
  const kept = a.filter((l) => old.has(l.level)), fresh = a.filter((l) => !old.has(l.level));
  if (fresh.length === 0 || kept.length !== old.size) return null;
  const reasons: string[] = [];
  const keys = [...new Set(b.flatMap((l) => Object.keys(l.scores)))];
  for (const was of b) {
    const now = kept.find((l) => l.level === was.level)!;
    for (const k of keys) {
      const x = was.scores[k], y = now.scores[k];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue; // a missing per-level score: the measure checks catch it
      const tol = noiseBand(GATE.tolerance, was.noise?.[k], now.noise?.[k]);
      if (x! - y! > tol) reasons.push(`levels[${was.level}] ${k} regressed ${(x! - y!).toFixed(2)} (> ${fmtNum(tol)})`);
    }
  }
  for (const l of fresh) {
    for (const k of keys) {
      const y = l.scores[k];
      const need = GATE.ceiling - noiseBand(GATE.tolerance, undefined, l.noise?.[k]);
      if (!Number.isFinite(y)) reasons.push(`new levels[${l.level}] ${k} is missing or not finite`);
      else if (y! < need) reasons.push(`new levels[${l.level}] ${k} ${y!.toFixed(2)} is out of its band (needs >= ${fmtNum(round2(need))})`);
    }
  }
  const measures: Measures = { ...after.measures };
  const balance = keys.filter((k) => Object.hasOwn(after.measures, k));
  for (const k of balance) measures[k] = round2(kept.reduce((s, l) => s + (l.scores[k] ?? 0), 0) / kept.length);
  const fitness = balance.length ? round2(balance.reduce((s, k) => s + measures[k]!, 0) / balance.length) : after.fitness;
  return { reasons, after: { ...after, levels: kept, measures, fitness } };
}

/**
 * `atCeiling`: score mode, but the target was already within minGain of the ceiling, so it was judged holding the line.
 * `notes`: soft-measure drops that did not discard, for the change's card and the report.
 */
export type GateResult = { keep: boolean; gain: number; reasons: string[]; atCeiling?: true; notes?: string[] };

/**
 * Gate modes. `score`: a gain of at least GATE.minGain on the target measure (or on fitness when there is no target),
 * with nothing else regressing past GATE.tolerance. `polish`: no gain needed; keep unless a measure (or fitness)
 * regresses past GATE.tolerance. Hard failures and non-finite values always discard, in both modes.
 * A score-mode target already within minGain of GATE.ceiling has nothing left to gain (a healthy game is not a finished
 * one), so it is judged like polish: kept unless something, fitness included, regresses past the tolerance.
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
  const added = newLevelPath(before, after);
  if (added) { reasons.push(...added.reasons); after = added.after; }
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const own = (m: Measures, k: string): number | undefined => (Object.hasOwn(m, k) ? m[k] : undefined);

  if (!finite(after.fitness)) reasons.push(`after fitness is not a finite number: ${String(after.fitness)}`);
  for (const [name, now] of Object.entries(after.measures)) {
    if (!finite(now)) reasons.push(`after measure ${name} is not a finite number: ${String(now)}`);
  }

  const band = (flat: number, key: string): number => noiseBand(flat, before.noise?.[key], after.noise?.[key]);
  const fmtBand = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2)); // "1" as before; "2.83" when noise widened it
  let gain = 0;
  let atCeiling = false;
  if (mode === 'polish') {
    // No gain needed, but fitness counts as a measure: a fall past the tolerance discards.
    if (!finite(before.fitness)) reasons.push(`before fitness is not a finite number: ${String(before.fitness)}`);
    else if (finite(after.fitness)) {
      gain = after.fitness - before.fitness;
      const tol = band(GATE.tolerance, 'fitness');
      if (-gain > tol) reasons.push(`fitness regressed ${(-gain).toFixed(2)} (> ${fmtBand(tol)})`);
    }
  } else {
    const b = target ? own(before.measures, target) : before.fitness;
    const a = target ? own(after.measures, target) : after.fitness;
    if (!finite(b) || !finite(a)) {
      reasons.push(`target ${target ? `measure "${target}"` : 'fitness'} is missing or not finite in a report`);
    } else {
      gain = a - b;
      if (b > GATE.ceiling - GATE.minGain) {
        atCeiling = true;
        const fb = before.fitness, fa = after.fitness;
        const tol = band(GATE.tolerance, 'fitness');
        if (finite(fb) && finite(fa) && fb - fa > tol) reasons.push(`fitness regressed ${(fb - fa).toFixed(2)} (> ${fmtBand(tol)})`);
      } else {
        const need = band(GATE.minGain, target ?? 'fitness');
        if (gain < need) reasons.push(`no real gain: ${gain.toFixed(2)} < ${fmtBand(need)}`);
      }
    }
  }

  const notes: string[] = [];
  for (const [name, was] of Object.entries(before.measures)) {
    const now = own(after.measures, name);
    if (now === undefined) reasons.push(`${name} missing from the after report (treated as a regression)`);
    else if (finite(was) && finite(now) && was - now > band(GATE.tolerance, name)) {
      const why = `${name} regressed ${(was - now).toFixed(2)} (> ${fmtBand(band(GATE.tolerance, name))})`;
      (GATE.soft.includes(name) && name !== target ? notes : reasons).push(why);
    }
  }

  return {
    keep: reasons.length === 0, gain, reasons,
    ...(atCeiling ? { atCeiling: true as const } : {}),
    ...(notes.length ? { notes } : {}),
  };
}
