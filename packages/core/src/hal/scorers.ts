// Registry of per-game scorers the Hal CLI drives. Add a game by registering its scorer here.
import type { Range } from './baseline.js';
import { scoreGearhold } from './gearhold-score.js';
import { scoreHyperline } from './hyperline-score.js';
import { scoreTidepool } from './tidepool-score.js';
import type { ScoreReport } from './types.js';

export type Scorer = {
  game: string;
  defaults: Range;
  /** Null if the range is usable, else a message. */
  validate(range: Range): string | null;
  score(range: Range): ScoreReport<unknown>;
};

const tidepool: Scorer = {
  game: 'tidepool-pals',
  defaults: { from: 1, to: 30, seeds: 20 },
  validate(r) {
    for (const k of ['from', 'to', 'seeds']) if (!Number.isInteger(r[k]) || (r[k] as number) < 1) return `--${k} must be a positive integer`;
    if ((r.from as number) > (r.to as number)) return '--from must not exceed --to';
    return null;
  },
  score: (r) => scoreTidepool({ from: r.from as number, to: r.to as number, seeds: r.seeds as number }),
};

const hyperline: Scorer = {
  game: 'hyperline',
  defaults: { seeds: 100, until: 1900 },
  validate(r) {
    for (const k of ['seeds', 'until']) if (!Number.isInteger(r[k]) || (r[k] as number) < 1) return `--${k} must be a positive integer`;
    return null;
  },
  score: (r) => scoreHyperline({ seeds: r.seeds as number, until: r.until as number }),
};

const gearhold: Scorer = {
  game: 'gearhold',
  defaults: {},
  validate: () => null,
  score: () => scoreGearhold(),
};

export const SCORERS: Record<string, Scorer> = { 'tidepool-pals': tidepool, hyperline, gearhold };

export function scorerFor(game: string): Scorer {
  const s = Object.hasOwn(SCORERS, game) ? SCORERS[game] : undefined;
  if (!s) throw new Error(`unknown game: ${game}`);
  return s;
}
