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

  it('a loss uses every move', () => {
    for (let n = 1; n <= 20; n++) {
      for (const s of seeds(5)) {
        const r = playLevel(levelDef(n), s);
        if (!r.won) {
          expect(r.stars).toBe(0);
          // Either every move was spent, or the shuffle cap (50) ended the play.
          expect(r.movesLeft === 0 || r.shuffles >= 50).toBe(true);
        }
      }
    }
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
});
