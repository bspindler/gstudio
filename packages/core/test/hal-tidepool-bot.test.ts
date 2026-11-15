import { describe, expect, it } from 'vitest';

import * as board from '../../../games/tidepool-pals/board.js';
import type { LevelDef } from '../../../games/tidepool-pals/board.js';
import { tidepoolLevel as levelDef } from '../src/hal/fixtures/tidepool-levels.js';
import { playLevel, type Engine } from '../src/hal/tidepool-bot.js';

// The robot is checked on frozen copies of the levels (fixtures/tidepool-levels.ts), so retuning, adding or renumbering
// the game's levels never touches this protected file.
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

  it('calls ensureBubbles where the game does: after building the board and after every collapse', () => {
    // index.html: startLevel runs ensureBubbles right after buildBoard; settle runs it right after each collapse.
    const calls: string[] = [];
    const spy: Engine = {
      ...board,
      buildBoard: (...a: Parameters<typeof board.buildBoard>) => { calls.push('build'); return board.buildBoard(...a); },
      collapse: (...a: Parameters<typeof board.collapse>) => { calls.push('collapse'); return board.collapse(...a); },
      ensureBubbles: (...a: Parameters<typeof board.ensureBubbles>) => { calls.push('bubbles'); return board.ensureBubbles(...a); },
    };
    playLevel(levelDef(9), 3, spy);
    expect(calls[0]).toBe('build');
    expect(calls[1]).toBe('bubbles');
    expect(calls.filter((c) => c === 'collapse').length).toBeGreaterThan(5);
    calls.forEach((c, i) => { if (c === 'collapse') expect(calls[i + 1]).toBe('bubbles'); });
  });

  it('a rescue goal larger than the bubbles on the board is winnable (ensureBubbles places the next one)', () => {
    const layout = ['.......', '.......', '.......', '...B...', '.......', '.......', '.......', '.......'];
    const def: LevelDef = { n: 9997, moves: 40, colors: 3, goals: [{ t: 'rescue', n: 2 }], layout };
    expect(seeds(10).some((s) => playLevel(def, s).won)).toBe(true);
  });

  it('is rescue-aware: plays the settle out and steers stranded pals toward the exit', () => {
    // Greedy-on-goals alone won 0.27 of these on average (20 seeds, 2026-11-15); a rough rescue-aware bot about 0.5.
    const ns = [11, 15, 19, 25, 26];
    const rate = ns.reduce((a, n) => a + seeds(20).filter((s) => playLevel(levelDef(n), s).won).length / 20, 0) / ns.length;
    expect(rate).toBeGreaterThanOrEqual(0.45);
  });

  it('extra moves continue the same play: identical to a level with that many more moves', () => {
    for (const n of [5, 11, 15, 19, 25, 26]) {
      for (const s of seeds(4)) {
        const def = levelDef(n);
        const r = playLevel(def, s, board, { extra: 5 });
        const { wonWithExtra, ...base } = r;
        expect(base).toEqual(playLevel(def, s));
        expect(wonWithExtra).toBe(playLevel({ ...def, moves: def.moves + 5 }, s).won);
      }
    }
  });

  it('`more` plays on past `extra`: identical to a level with that many more moves', () => {
    let lostWithExtra = 0;
    for (const n of [11, 19, 28]) {
      for (const s of seeds(5)) {
        const def = levelDef(n);
        const { wonWithExtra, wonWithMore, ...base } = playLevel(def, s, board, { extra: 5, more: def.moves });
        expect(base).toEqual(playLevel(def, s));
        expect(wonWithExtra).toBe(playLevel({ ...def, moves: def.moves + 5 }, s).won);
        expect(wonWithMore).toBe(playLevel({ ...def, moves: def.moves * 2 }, s).won);
        if (wonWithExtra) expect(wonWithMore).toBe(true);
        else lostWithExtra++;
      }
    }
    expect(lostWithExtra).toBeGreaterThan(0); // the `more` path past a +5 loss ran
  });

  it('`more` must be at least `extra`', () => {
    expect(() => playLevel(levelDef(1), 1, board, { extra: 5, more: 3 })).toThrow(/more/);
  });
});
