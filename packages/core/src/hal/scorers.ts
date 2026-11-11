// Registry of per-game scorers the Hal CLI drives. Add a game by registering its scorer here.
import type { Range } from './baseline.js';
import { scoreGearhold } from './gearhold-score.js';
import { scoreGearholdPlay, type PlayRecord } from './gearhold-play-score.js';
import { scoreHyperline } from './hyperline-score.js';
import { scoreTidepool } from './tidepool-score.js';
import type { ScoreReport } from './types.js';

export type Scorer = {
  game: string;
  defaults: Range;
  /** Null if the range is usable, else a message. */
  validate(range: Range): string | null;
  /** May be async (browser-backed scorers). A throw or rejection is a hard failure: the CLI exits 1 and compares nothing. */
  score(range: Range): ScoreReport<unknown> | Promise<ScoreReport<unknown>>;
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

/** Plays `levels` levels (0-based, 0..levels-1) x `seeds` seeds in a browser; injected so core never imports Playwright. */
export type GearholdPlayRunner = (o: { levels: number[]; seeds: number }) => Promise<{ records: PlayRecord[]; errors: string[] }>;

/**
 * The browser-backed Gearhold scorer. Runner errors (page errors, hang, "browser unavailable:", blocked outbound
 * request) make score() reject, never a fitness the gate could compare.
 */
export function gearholdPlayScorer(run: GearholdPlayRunner): Scorer {
  return {
    game: 'gearhold-play',
    defaults: { levels: 3, seeds: 50 },
    validate(r) {
      for (const k of ['levels', 'seeds']) if (!Number.isInteger(r[k]) || (r[k] as number) < 1) return `--${k} must be a positive integer`;
      return null;
    },
    async score(r) {
      const { records, errors } = await run({ levels: Array.from({ length: r.levels as number }, (_, i) => i), seeds: r.seeds as number });
      if (errors.length) throw new Error(`gearhold-play hard failure (${errors.length}): ${errors.join('; ')}`);
      return scoreGearholdPlay(records);
    },
  };
}

export function scorerFor(game: string, registry: Record<string, Scorer> = SCORERS): Scorer {
  const s = Object.hasOwn(registry, game) ? registry[game] : undefined;
  if (!s) throw new Error(`unknown game: ${game}`);
  return s;
}
