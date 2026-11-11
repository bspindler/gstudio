import { describe, expect, it } from 'vitest';
import { SCORERS, scorerFor } from '../src/hal/scorers.js';

describe('hal scorers', () => {
  it('registers tidepool with its defaults', () => {
    expect(scorerFor('tidepool-pals').defaults).toEqual({ from: 1, to: 30, seeds: 20 });
    expect(Object.keys(SCORERS)).toEqual(['tidepool-pals']);
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
});
