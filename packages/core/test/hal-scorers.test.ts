import { describe, expect, it } from 'vitest';
import { gearholdPlayScorer, HYPERLINE_UNTIL, SCORERS, scorerFor, TIDEPOOL_TO } from '../src/hal/scorers.js';
import { LEVELS } from '../../../games/gearhold/levels.js';
import { AUTHORED } from '../../../games/tidepool-pals/levels.js';
import { SECTORS, SECTOR_LEN } from '../../../games/hyperline/lib/world.js';

describe('hal scorers', () => {
  it('registers tidepool with its defaults', () => {
    expect(scorerFor('tidepool-pals').defaults).toEqual({ from: 1, to: 30, seeds: 20 });
  });
  it('throws on unknown games, including prototype names', () => {
    expect(() => scorerFor('nope')).toThrow(/unknown game: nope/);
    expect(() => scorerFor('constructor')).toThrow(/unknown game: constructor/);
  });
  it('validates ranges like the old CLI', () => {
    const s = scorerFor('tidepool-pals');
    expect(s.validate({ from: 1, to: 5, seeds: 2 })).toBeNull();
    expect(s.validate({ from: 0, to: 5, seeds: 2 })).toBe('--from must be a positive integer');
    expect(s.validate({ from: 1, to: 5.5, seeds: 2 })).toBe('--to must be a positive integer');
    expect(s.validate({ from: 6, to: 5, seeds: 2 })).toBe('--from must not exceed --to');
  });
  it('scores via scoreTidepool', async () => {
    expect((await scorerFor('tidepool-pals').score({ from: 1, to: 1, seeds: 1 })).game).toBe('tidepool-pals');
  });
  it('registers all three games', () => {
    expect(Object.keys(SCORERS).sort()).toEqual(['gearhold', 'hyperline', 'tidepool-pals']);
    expect(scorerFor('hyperline').defaults).toEqual({ seeds: 100, until: 1900 });
    expect(scorerFor('gearhold').defaults).toEqual({});
  });
  it('validates hyperline ranges', () => {
    const s = scorerFor('hyperline');
    expect(s.validate({ seeds: 2, until: 100 })).toBeNull();
    expect(s.validate({ seeds: 0, until: 100 })).toBe('--seeds must be a positive integer');
    expect(s.validate({ seeds: 2, until: 1.5 })).toBe('--until must be a positive integer');
    expect(scorerFor('gearhold').validate({})).toBeNull();
  });
  it('each scorer reports its own slug', async () => {
    expect((await scorerFor('hyperline').score({ seeds: 1, until: 200 })).game).toBe('hyperline');
    expect((await scorerFor('gearhold').score({})).game).toBe('gearhold');
  });
  describe('gearhold-play (injected browser runner)', () => {
    const rec = (level: number, seed: number) => ({ level, seed, result: 'win' as const, time: 60, hpLeft: 50, kills: 3, foes: 3, shotsFired: 10, hits: 5, damageTaken: 10, damageUnseen: 0, cause: '' });
    it('is not in the core registry (core cannot import Playwright) and plays every Gearhold level x 50 seeds', () => {
      expect(Object.keys(SCORERS)).not.toContain('gearhold-play');
      const s = gearholdPlayScorer(async () => ({ records: [], errors: [] }));
      expect(s.defaults).toEqual({ levels: LEVELS.length, seeds: 50, seedBase: 0 }); // follows the game: a new level is played too
      expect(s.validate({ levels: LEVELS.length, seeds: 50, seedBase: 0 })).toBeNull();
      expect(s.validate({ levels: 0, seeds: 50, seedBase: 0 })).toBe('--levels must be a positive integer');
      expect(s.validate({ levels: 3, seeds: 1.5, seedBase: 0 })).toBe('--seeds must be a positive integer');
      expect(s.validate({ levels: 99, seeds: 1, seedBase: 0 })).toBe(`--levels must be at most ${LEVELS.length} (Gearhold has ${LEVELS.length} levels)`);
    });
    it('awaits the runner with levels 0..n-1 and scores its records', async () => {
      const calls: unknown[] = [];
      const s = gearholdPlayScorer(async (o) => { calls.push(o); return { records: o.levels.flatMap((l) => [rec(l, 0), rec(l, 1)]), errors: [] }; });
      const r = await s.score({ levels: 2, seeds: 2, seedBase: 0 });
      expect(calls).toEqual([{ levels: [0, 1], seeds: 2, seedBase: 0 }]);
      expect(r.game).toBe('gearhold-play');
      expect(Number.isFinite(r.fitness)).toBe(true);
    });
    it('validates --seed-base and passes it to the runner', async () => {
      const calls: unknown[] = [];
      const s = gearholdPlayScorer(async (o) => { calls.push(o); return { records: [rec(0, o.seedBase)], errors: [] }; });
      expect(s.validate({ levels: 1, seeds: 1, seedBase: -1 })).toBe('--seed-base must be a non-negative integer');
      expect(s.validate({ levels: 1, seeds: 1, seedBase: 1.5 })).toBe('--seed-base must be a non-negative integer');
      await s.score({ levels: 1, seeds: 1, seedBase: 50 });
      expect(calls).toEqual([{ levels: [0], seeds: 1, seedBase: 50 }]);
    });
    it('rejects a partial record set (levels x seeds expected)', async () => {
      const s = gearholdPlayScorer(async () => ({ records: [rec(0, 0)], errors: [] }));
      await expect(s.score({ levels: 1, seeds: 2, seedBase: 0 })).rejects.toThrow(/returned 1 records, expected 2/);
    });
    it('rejects on runner errors instead of returning a score', async () => {
      const s = gearholdPlayScorer(async () => ({ records: [rec(0, 0)], errors: ['level 0 seed 1: hang: a batch took too long'] }));
      await expect(s.score({ levels: 1, seeds: 2, seedBase: 0 })).rejects.toThrow(/hard failure \(1\): level 0 seed 1: hang/);
    });
    it('scorerFor accepts an extended registry', () => {
      const s = gearholdPlayScorer(async () => ({ records: [], errors: [] }));
      expect(scorerFor('gearhold-play', { ...SCORERS, 'gearhold-play': s })).toBe(s);
      expect(() => scorerFor('gearhold-play')).toThrow(/unknown game/);
    });
  });
});

describe('default ranges follow each game\'s content (new levels and sectors get scored)', () => {
  it('Tidepool: the hand-made levels plus 10 generated ones, at least 1-30', () => {
    expect(TIDEPOOL_TO).toBe(Math.max(30, AUTHORED.length + 10));
    expect(scorerFor('tidepool-pals').defaults).toEqual({ from: 1, to: TIDEPOOL_TO, seeds: 20 });
  });
  it('Hyperline: 150 units into the last (endless) sector, so every sector is run and reach is a fraction of the whole course', () => {
    expect(HYPERLINE_UNTIL).toBe((SECTORS.length - 1) * SECTOR_LEN + 150);
    expect(scorerFor('hyperline').defaults).toEqual({ seeds: 100, until: HYPERLINE_UNTIL });
    expect(Math.floor((HYPERLINE_UNTIL - 1) / SECTOR_LEN)).toBe(SECTORS.length - 1); // the last sector is reached
  });
  it('today\'s numbers are unchanged (3 Gearhold levels, Tidepool 1-30, Hyperline 1900 with 8 sectors), so tonight\'s baselines still compare', () => {
    if (LEVELS.length === 3) expect(gearholdPlayScorer(async () => ({ records: [], errors: [] })).defaults.levels).toBe(3);
    if (AUTHORED.length <= 20) expect(TIDEPOOL_TO).toBe(30);
    if (SECTORS.length === 8) expect(HYPERLINE_UNTIL).toBe(1900);
  });
});
