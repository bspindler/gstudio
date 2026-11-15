// Tidepool Pals levels as levelDef(n) gave them on 2026-11-15 (hand-made 1-20, generated 25, 26 and 28), frozen for
// Hal's robot and scorer tests. Those tests check the robot and the scorer, so they play these copies, never the levels
// of the day: Hal may retune, add or renumber levels without touching a protected file (permission split A). Intro
// text is left out (the robot never reads it). Refresh only with Brian, and only to follow a change to the board rules.
import type { LevelDef } from '../../../../../games/tidepool-pals/board.js';

const L = (d: LevelDef): LevelDef => d;
export const TIDEPOOL_LEVELS: Readonly<Record<number, LevelDef>> = {
  1: L({ n: 1, moves: 18, colors: 4, goals: [{ t: 'collect', c: 0, n: 12 }], layout: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'], pool: 0 }),
  2: L({ n: 2, moves: 20, colors: 4, goals: [{ t: 'collect', c: 1, n: 18 }], layout: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'], pool: 0 }),
  3: L({ n: 3, moves: 22, colors: 4, goals: [{ t: 'rescue', n: 1 }, { t: 'collect', c: 2, n: 16 }], layout: ['.......', '.......', '.......', '...B...', '.......', '.......', '.......', '.......'], tide: { high: 6, low: 2, dir: 'up' }, pool: 0 }),
  4: L({ n: 4, moves: 22, colors: 4, goals: [{ t: 'collect', c: 0, n: 10 }, { t: 'collect', c: 2, n: 10 }], layout: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'], tide: { high: 6, low: 2, dir: 'up' }, pool: 0 }),
  5: L({ n: 5, moves: 20, colors: 4, goals: [{ t: 'rescue', n: 1 }, { t: 'collect', c: 1, n: 16 }], layout: ['...P...', '.......', '.......', '.......', '.......', '.......', '.......', '.......'], exit: 'down', pool: 0 }),
  6: L({ n: 6, moves: 22, colors: 4, goals: [{ t: 'collect', c: 3, n: 16 }], layout: ['.......', '.......', '.......', '.......', '.......', '.......', 'oo...oo', 'oo...oo'], tide: { high: 4, low: 3, dir: 'up' }, pool: 0 }),
  7: L({ n: 7, moves: 22, colors: 4, goals: [{ t: 'litter' }], layout: ['.......', '.......', '.......', '.......', '.......', '.......', '..lll..', '.lllll.'], tide: { high: 6, low: 2, dir: 'up' }, pool: 0 }),
  8: L({ n: 8, moves: 24, colors: 5, goals: [{ t: 'collect', c: 4, n: 20 }], layout: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'], tide: { high: 4, low: 3, dir: 'right' }, pool: 0 }),
  9: L({ n: 9, moves: 24, colors: 5, goals: [{ t: 'rescue', n: 1 }, { t: 'collect', c: 2, n: 14 }], layout: ['x.....x', '.......', '.......', '.......', '...B...', '.......', '.......', 'x.....x'], tide: { high: 5, low: 3, dir: 'left' }, pool: 0 }),
  10: L({ n: 10, moves: 24, colors: 5, goals: [{ t: 'ice', n: 4 }], layout: ['.......', '.......', '.......', '.i...i.', '.......', '.i...i.', '.......', '.......'], tide: { high: 5, low: 3, dir: 'up' }, pool: 0 }),
  11: L({ n: 11, moves: 40, colors: 5, goals: [{ t: 'rescue', n: 1 }, { t: 'collect', c: 0, n: 12 }], layout: ['.......', '.P.....', '.......', '.......', '.......', '.......', '.......', '.......'], tide: { high: 3, low: 3, dir: 'right' }, exit: 'right', pool: 1 }),
  12: L({ n: 12, moves: 26, colors: 5, goals: [{ t: 'collect', c: 1, n: 24 }], layout: ['o.....o', 'o.....o', '.......', '.......', '.......', '.......', '.......', '.......'], tide: { high: 4, low: 3, dir: 'left' }, pool: 1 }),
  13: L({ n: 13, moves: 26, colors: 5, goals: [{ t: 'collect', c: 0, n: 16 }, { t: 'collect', c: 3, n: 16 }], layout: ['.......', 'x.....x', 'xx...xx', 'xx...xx', 'x.....x', '.......', '.......', '.......'], tide: { high: 5, low: 2, dir: 'up' }, pool: 1 }),
  14: L({ n: 14, moves: 42, colors: 5, goals: [{ t: 'litter' }, { t: 'ice', n: 3 }], layout: ['.......', '.......', '.i...i.', '.......', '.i...i.', '.......', 'l.....l', 'll...ll'], tide: { high: 4, low: 3, dir: 'right' }, pool: 1 }),
  15: L({ n: 15, moves: 34, colors: 5, goals: [{ t: 'rescue', n: 1 }], layout: ['.P...P.', '.......', '.......', '.l...l.', '.......', '.......', '.......', '.......'], tide: { high: 5, low: 2, dir: 'up' }, exit: 'down', pool: 1 }),
  16: L({ n: 16, moves: 26, colors: 5, goals: [{ t: 'collect', c: 2, n: 22 }], layout: ['.......', '.......', 'o.....o', 'o.....o', 'o.....o', 'o.....o', '.......', '.......'], tide: { high: 4, low: 3, dir: 'left' }, pool: 1 }),
  17: L({ n: 17, moves: 28, colors: 5, goals: [{ t: 'ice', n: 10 }], layout: ['.......', 'i.....i', '.i...i.', '...i...', '...i...', '.i...i.', 'i.....i', '.......'], tide: { high: 4, low: 3, dir: 'up' }, pool: 1 }),
  18: L({ n: 18, moves: 28, colors: 5, goals: [{ t: 'litter' }, { t: 'collect', c: 2, n: 18 }], layout: ['x.....x', '.......', '.......', 'l.....l', 'll...ll', '.......', '.......', 'x.....x'], tide: { high: 4, low: 3, dir: 'right' }, pool: 1 }),
  19: L({ n: 19, moves: 34, colors: 5, goals: [{ t: 'rescue', n: 1 }, { t: 'litter' }], layout: ['.......', '....P..', '.......', '.......', '.......', '.......', 'll...ll', 'lll.lll'], tide: { high: 3, low: 4, dir: 'left' }, exit: 'left', pool: 1 }),
  20: L({ n: 20, moves: 32, colors: 5, goals: [{ t: 'litter' }, { t: 'ice', n: 4 }, { t: 'collect', c: 4, n: 16 }], layout: ['x.....x', '.......', '.i...i.', '.......', '.i...i.', 'o.....o', 'll...ll', 'lll.lll'], tide: { high: 4, low: 3, dir: 'right' }, pool: 1 }),
  25: L({ n: 25, moves: 38, colors: 5, goals: [{ t: 'rescue', n: 1 }, { t: 'litter' }], layout: ['.......', '....P..', '.......', '.......', '.......', '.......', '...l...', 'lllllll'], tide: { high: 6, low: 2, dir: 'up' }, exit: 'down', pool: 2 }),
  26: L({ n: 26, moves: 40, colors: 5, goals: [{ t: 'rescue', n: 1 }, { t: 'litter' }], layout: ['.....P.', '.......', '.......', '.......', '.......', '.......', '...l...', 'lllllll'], tide: { high: 3, low: 2, dir: 'up' }, exit: 'down', pool: 2 }),
  28: L({ n: 28, moves: 40, colors: 5, goals: [{ t: 'rescue', n: 1 }, { t: 'litter' }], layout: ['.......', '.......', '.......', '.......', '...P...', '.......', '...l...', 'lllllll'], exit: 'down', pool: 2 }),
};

/** The frozen copy of level n; throws for a level that has none. */
export function tidepoolLevel(n: number): LevelDef {
  const d = Object.hasOwn(TIDEPOOL_LEVELS, n) ? TIDEPOOL_LEVELS[n] : undefined;
  if (!d) throw new Error(`no frozen Tidepool level ${n}`);
  return structuredClone(d);
}
