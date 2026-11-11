import { describe, expect, it } from 'vitest';

import type { LevelDef } from '../../../games/tidepool-pals/board.js';
import { levelDef } from '../../../games/tidepool-pals/levels.js';
import { playLevel } from '../src/hal/tidepool-bot.js';

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('playLevel', () => {
  it('is deterministic', () => {
    expect(playLevel(levelDef(1), 7)).toEqual(playLevel(levelDef(1), 7));
  });

  it('different seeds can differ', () => {
    const used = new Set(seeds(20).map((s) => playLevel(levelDef(10), s).movesUsed));
    expect(used.size).toBeGreaterThan(1);
  });

  it('wins the easy first level almost always', () => {
    const def = levelDef(1);
    const results = seeds(20).map((s) => playLevel(def, s));
    expect(results.filter((r) => r.won).length).toBeGreaterThanOrEqual(18);
    for (const r of results.filter((x) => x.won)) {
      expect(r.stars).toBeGreaterThanOrEqual(1);
      expect(r.movesLeft).toBe(def.moves - r.movesUsed);
    }
  });

  it('a loss on levels 1-20 uses every move', () => {
    // playLevel can also end a loss early (shuffle cap, or no tappable move); those paths are covered by
    // the shuffle-cap test. On these levels and seeds every loss runs out of moves (28 of 100 plays at time of writing).
    let losses = 0;
    for (let n = 1; n <= 20; n++) {
      for (const s of seeds(5)) {
        const r = playLevel(levelDef(n), s);
        if (!r.won) {
          losses++;
          expect(r.stars).toBe(0);
          expect(r.movesLeft).toBe(0);
          expect(r.movesUsed).toBe(levelDef(n).moves);
        }
      }
    }
    expect(losses).toBeGreaterThan(0);
  });

  it('applies the tide on level 3', () => {
    expect(seeds(10).some((s) => playLevel(levelDef(3), s).tideTurns >= 1)).toBe(true);
  });

  it('counts rescues on level 5', () => {
    expect(seeds(10).some((s) => playLevel(levelDef(5), s).rescued >= 1)).toBe(true);
  });

  it('terminates on a board that always needs shuffling', { timeout: 2000 }, () => {
    const layout = Array.from({ length: 8 }, (_, r) => (r === 0 ? 'xxxxx..' : 'xxxxxxx'));
    const def: LevelDef = {
      n: 9999, moves: 10, colors: 5, goals: [{ t: 'collect', c: 0, n: 999 }], layout,
    };
    expect(playLevel(def, 1).won).toBe(false);
  });

  it('stops at the shuffle cap when no shuffle ever creates a move', { timeout: 2000 }, () => {
    // All sand: no free pal exists, so hasMoves stays false and shuffle can neither recolour nor spawn a bomb.
    const layout = Array.from({ length: 4 }, () => 'ssss');
    const def: LevelDef = { n: 9998, moves: 200, colors: 5, goals: [{ t: 'collect', c: 0, n: 999 }], layout };
    const r = playLevel(def, 1);
    expect(r.shuffles).toBe(50);
    expect(r.won).toBe(false);
    expect(r.movesUsed).toBe(0);
  });
});
