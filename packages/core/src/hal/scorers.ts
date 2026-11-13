// Registry of per-game scorers the Hal CLI drives. Add a game by registering its scorer here.
import type { Range } from './baseline.js';
import { scoreGearhold } from './gearhold-score.js';
import { LEVELS } from '../../../../games/gearhold/levels.js';
import { AUTHORED } from '../../../../games/tidepool-pals/levels.js';
import { SECTORS, SECTOR_LEN } from '../../../../games/hyperline/lib/world.js';
import { GEARHOLD_PLAY_DEFAULTS, scoreGearholdPlay, type PlayRecord } from './gearhold-play-score.js';
import { scoreHyperline } from './hyperline-score.js';
import { LANTERNKEEP_DEFAULTS, scoreLanternkeep } from './lanternkeep-score.js';
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

// The default ranges follow each game's own content, so a level or sector Hal (or Brian) adds is played and scored
// like the rest: every Gearhold level; Tidepool's hand-made levels plus 10 generated ones (at least 1-30); Hyperline
// up to 150 units into its last, endless sector (so `reach` stays a fraction of the whole course).
/** Tidepool levels scored by default: the hand-made ones and 10 generated after them, at least 30. */
export const TIDEPOOL_TO = Math.max(30, AUTHORED.length + 10);
/** Hyperline's default `until`: 150 units into the final sector. */
export const HYPERLINE_UNTIL = (SECTORS.length - 1) * SECTOR_LEN + 150;

const tidepool: Scorer = {
  game: 'tidepool-pals',
  defaults: { from: 1, to: TIDEPOOL_TO, seeds: 20 },
  validate(r) {
    for (const k of ['from', 'to', 'seeds']) if (!Number.isInteger(r[k]) || (r[k] as number) < 1) return `--${k} must be a positive integer`;
    if ((r.from as number) > (r.to as number)) return '--from must not exceed --to';
    return null;
  },
  score: (r) => scoreTidepool({ from: r.from as number, to: r.to as number, seeds: r.seeds as number }),
};

const hyperline: Scorer = {
  game: 'hyperline',
  defaults: { seeds: 100, until: HYPERLINE_UNTIL },
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

// Lanternkeep has no randomness of its own: seeds vary the bot's tile picks, and each seed plays four styles.
const lanternkeep: Scorer = {
  game: 'lanternkeep',
  defaults: { ...LANTERNKEEP_DEFAULTS },
  validate(r) {
    if (!Number.isInteger(r.seeds) || (r.seeds as number) < 1) return '--seeds must be a positive integer';
    return null;
  },
  score: (r) => scoreLanternkeep({ seeds: r.seeds as number }),
};

export const SCORERS: Record<string, Scorer> = { 'tidepool-pals': tidepool, hyperline, gearhold, lanternkeep };

/** Plays `levels` levels (0-based, 0..levels-1) x `seeds` seeds in a browser; injected so core never imports Playwright. */
export type GearholdPlayRunner = (o: { levels: number[]; seeds: number; seedBase: number }) => Promise<{ records: PlayRecord[]; errors: string[] }>;

/**
 * The browser-backed Gearhold scorer. Runner errors (page errors, hang, "browser unavailable:", blocked outbound
 * request) make score() reject, never a fitness the gate could compare.
 */
export function gearholdPlayScorer(run: GearholdPlayRunner): Scorer {
  return {
    game: 'gearhold-play',
    defaults: { ...GEARHOLD_PLAY_DEFAULTS, levels: LEVELS.length }, // every level the game has
    validate(r) {
      for (const k of ['levels', 'seeds']) if (!Number.isInteger(r[k]) || (r[k] as number) < 1) return `--${k} must be a positive integer`;
      if ((r.levels as number) > LEVELS.length) return `--levels must be at most ${LEVELS.length} (Gearhold has ${LEVELS.length} levels)`;
      if (!Number.isInteger(r.seedBase) || (r.seedBase as number) < 0) return '--seed-base must be a non-negative integer';
      return null;
    },
    async score(r) {
      const { records, errors } = await run({ levels: Array.from({ length: r.levels as number }, (_, i) => i), seeds: r.seeds as number, seedBase: r.seedBase as number });
      if (errors.length) throw new Error(`gearhold-play hard failure (${errors.length}): ${errors.join('; ')}`);
      const want = (r.levels as number) * (r.seeds as number);
      if (records.length !== want) throw new Error(`gearhold-play: runner returned ${records.length} records, expected ${want}; no score`);
      return scoreGearholdPlay(records);
    },
  };
}

export function scorerFor(game: string, registry: Record<string, Scorer> = SCORERS): Scorer {
  const s = Object.hasOwn(registry, game) ? registry[game] : undefined;
  if (!s) throw new Error(`unknown game: ${game}`);
  return s;
}
