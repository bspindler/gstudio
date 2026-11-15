// Measurement v2, P1.2: every seeded scorer reports a standard error per measure, from resampling its seeds.
import { describe, expect, it } from 'vitest';
import { bootstrapNoise, NOISE_RESAMPLES } from '../src/hal/noise.js';

describe('bootstrapNoise', () => {
  it('a measure that does not depend on the seeds has no noise; one that does has some', () => {
    const wins = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1]; // seed i won or lost
    const noise = bootstrapNoise(wins.length, (idx) => {
      const rate = (100 * idx.reduce((s, i) => s + wins[i]!, 0)) / idx.length;
      return { measures: { flat: 100, winRate: rate }, fitness: (100 + rate) / 2 };
    });
    expect(noise.flat).toBe(0);
    // A win rate of 60% over 10 seeds: SE ~ 100 * sqrt(.6 * .4 / 10) ~ 15.5.
    expect(noise.winRate).toBeGreaterThan(10);
    expect(noise.winRate).toBeLessThan(21);
    expect(noise.fitness).toBeCloseTo(noise.winRate! / 2, 1);
  });

  it('is deterministic and resamples NOISE_RESAMPLES times', () => {
    let calls = 0;
    const f = (idx: number[]) => { calls++; return { measures: { a: idx[0]! }, fitness: idx[0]! }; };
    const a = bootstrapNoise(5, f);
    expect(calls).toBe(NOISE_RESAMPLES);
    expect(bootstrapNoise(5, f)).toEqual(a);
  });

  it('one seed has nothing to resample: zero noise', () => {
    expect(bootstrapNoise(1, () => ({ measures: { a: 50 }, fitness: 50 }))).toEqual({ a: 0, fitness: 0 });
  });
});
