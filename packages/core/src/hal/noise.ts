// Seed noise: how much a scorer's measures would move on a different draw of seeds. Each seeded scorer passes a
// function that recomputes its measures from a list of seed indices (with repeats); bootstrapNoise resamples the
// seeds with replacement and returns the standard deviation of each measure (and fitness) across resamples, a
// standard error in score points. The gate uses it to widen its tolerance and min gain (gate.ts noiseBand, D2).
import type { Measures } from './types.js';

/** Resamples per score. 200 is plenty for a standard error to about 5%. */
export const NOISE_RESAMPLES = 200;

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** A small fixed-seed PRNG, so the noise estimate is the same every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapNoise(seeds: number, measure: (idx: number[]) => { measures: Measures; fitness: number }, resamples = NOISE_RESAMPLES): Measures {
  const base = measure(Array.from({ length: seeds }, (_, i) => i));
  const keys = [...Object.keys(base.measures), 'fitness'];
  if (seeds < 2) return Object.fromEntries(keys.map((k) => [k, 0]));
  const rnd = prng(0x5eed);
  const sum: Record<string, number> = {}, sq: Record<string, number> = {};
  for (const k of keys) { sum[k] = 0; sq[k] = 0; }
  // `resamples` samples in all: the full seed set itself, plus resamples - 1 draws with replacement.
  let n = 0;
  for (let r = 0; r < resamples - 1; r++) add(measure(Array.from({ length: seeds }, () => Math.floor(rnd() * seeds))));
  add(base);
  function add(m: { measures: Measures; fitness: number }) {
    n++;
    for (const k of keys) { const v = k === 'fitness' ? m.fitness : (m.measures[k] ?? 0); sum[k]! += v; sq[k]! += v * v; }
  }
  return Object.fromEntries(keys.map((k) => {
    const mean = sum[k]! / n;
    return [k, round2(Math.sqrt(Math.max(0, sq[k]! / n - mean * mean)))];
  }));
}
