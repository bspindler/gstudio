import { describe, expect, it } from 'vitest';

import { dailySeed, hashString, msToNextUtcDay, mulberry32, utcDay } from '../../../games/hyperline/lib/rng.js';

describe('hyperline rng', () => {
  it('mulberry32 is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(1234), b = mulberry32(1234);
    const xs = Array.from({ length: 500 }, () => a());
    expect(xs).toEqual(Array.from({ length: 500 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('different seeds give different streams', () => {
    const a = mulberry32(1), b = mulberry32(2);
    expect(Array.from({ length: 8 }, () => a())).not.toEqual(Array.from({ length: 8 }, () => b()));
  });

  it('hashString is a stable 32-bit unsigned hash', () => {
    expect(hashString('hyperline')).toBe(hashString('hyperline'));
    expect(hashString('a')).not.toBe(hashString('b'));
    const h = hashString('x');
    expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
  });

  it('utcDay uses the UTC calendar day, not local time', () => {
    expect(utcDay(Date.UTC(2026, 10, 7, 23, 59, 59))).toBe('2026-11-07');
    expect(utcDay(Date.UTC(2026, 10, 8, 0, 0, 0))).toBe('2026-11-08');
  });

  it('dailySeed is the same all day and changes with the date', () => {
    expect(dailySeed('2026-11-07')).toBe(dailySeed('2026-11-07'));
    expect(dailySeed('2026-11-07')).not.toBe(dailySeed('2026-11-08'));
  });

  it('msToNextUtcDay counts down to the real UTC midnight', () => {
    expect(msToNextUtcDay(Date.UTC(2026, 10, 7, 23, 0, 0))).toBe(3600_000);
    expect(msToNextUtcDay(Date.UTC(2026, 10, 7, 0, 0, 0))).toBe(86400_000);
  });
});
