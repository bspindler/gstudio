import { describe, expect, it } from 'vitest';

import { extraMovesCanWin } from '../../../games/tidepool-pals/board.js';

// Hard rule 4 (no dark patterns): the out-of-moves screen offers +5 moves (sold, or paid in pearls, which are also
// sold) only when five more moves could still win. The bound is generous on purpose: each unfinished goal needs no
// more than 5x the best one-move gain the player made toward it on this level (at least 1 a move), so the offer hides
// only when a goal is clearly out of reach.
const def = { goals: [{ t: 'collect', c: 0, n: 30 }, { t: 'rescue', n: 2 }] } as never;
const prog = (coral: number, rescue: number) => ({ collect: { 0: coral }, sand: 0, ice: 0, litter: 0, rescue }) as never;

describe('extraMovesCanWin', () => {
  it('a goal within five of the best moves made toward it is reachable', () => {
    expect(extraMovesCanWin(def, prog(10, 2), [6, 1], 5)).toBe(true); // 20 left <= 5 x 6
    expect(extraMovesCanWin(def, prog(0, 2), [6, 1], 5)).toBe(true); // 30 left <= 30
  });
  it('a goal further away than five best moves is out of reach: no offer', () => {
    expect(extraMovesCanWin(def, prog(4, 2), [5, 1], 5)).toBe(false); // 26 left > 25
  });
  it('every unfinished goal must be reachable; finished goals do not count', () => {
    expect(extraMovesCanWin(def, prog(28, 0), [6, 0], 5)).toBe(true); // 2 coral; 2 rescues at the 1-a-move floor
    expect(extraMovesCanWin({ goals: [{ t: 'rescue', n: 8 }] } as never, prog(0, 1), [0], 5)).toBe(false); // 7 > 5 x 1
  });
  it('a goal never moved still gets the floor of 1 a move', () => {
    expect(extraMovesCanWin({ goals: [{ t: 'collect', c: 0, n: 4 }] } as never, prog(0, 0), [0], 5)).toBe(true);
  });
  it('rejects a best list that does not match the goals', () => {
    expect(() => extraMovesCanWin(def, prog(0, 0), [1], 5)).toThrow(/goal/);
  });
});
