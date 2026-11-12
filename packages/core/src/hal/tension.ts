// Tension: a first measure aimed at fun rather than balance. A level whose wins are all comfortable is dull; one
// whose wins are all squeakers is stressful. The fun is in between, so a healthy level has some close finishes.
// Each game says what "close" means (Tidepool: few moves left; Gearhold: little health left); this file scores it.
// It is a measure, not part of fitness yet: a ticket can target it and the gate keeps it from falling, but tonight's
// fitness numbers stay comparable with earlier nights.

/** The healthy share of a level's wins that are close finishes. Brian-reviewable, like the other bands. */
export const TENSION_BAND = [0.15, 0.5] as const;
/** A level needs at least this many wins before its share means anything. */
export const TENSION_MIN_WINS = 5;

/** 100 inside [lo, hi], falling linearly to 0 at 0 and at 1. */
export function bandScore(x: number, [lo, hi]: readonly [number, number]): number {
  if (!Number.isFinite(x)) return 0;
  if (x < lo) return Math.max(0, (100 * x) / lo);
  if (x > hi) return Math.max(0, (100 * (1 - x)) / (1 - hi));
  return 100;
}

/** The tension measure: the mean band score of the levels with enough wins (100 when none qualify; win-rate measures cover that). */
export function tensionMeasure(levels: Array<{ wins: number; close: number }>): number {
  const scored = levels.filter((l) => l.wins >= TENSION_MIN_WINS).map((l) => bandScore(l.close / l.wins, TENSION_BAND));
  return scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100 : 100;
}
