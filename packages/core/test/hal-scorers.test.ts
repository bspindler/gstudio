import { describe, expect, it } from 'vitest';
import { SCORERS, scorerFor } from '../src/hal/scorers.js';

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
  it('scores via scoreTidepool', () => {
    expect(scorerFor('tidepool-pals').score({ from: 1, to: 1, seeds: 1 }).game).toBe('tidepool-pals');
  });
  it('registers all three games', () => {
    expect(Object.keys(SCORERS).sort()).toEqual(['gearhold', 'hyperline', 'tidepool-pals']);
    expect(scorerFor('hyperline').defaults).toEqual({ seeds: 20, until: 1900 });
    expect(scorerFor('gearhold').defaults).toEqual({});
  });
  it('validates hyperline ranges', () => {
    const s = scorerFor('hyperline');
    expect(s.validate({ seeds: 2, until: 100 })).toBeNull();
    expect(s.validate({ seeds: 0, until: 100 })).toBe('--seeds must be a positive integer');
    expect(s.validate({ seeds: 2, until: 1.5 })).toBe('--until must be a positive integer');
    expect(scorerFor('gearhold').validate({})).toBeNull();
  });
  it('each scorer reports its own slug', () => {
    expect(scorerFor('hyperline').score({ seeds: 1, until: 200 }).game).toBe('hyperline');
    expect(scorerFor('gearhold').score({}).game).toBe('gearhold');
  });
});
