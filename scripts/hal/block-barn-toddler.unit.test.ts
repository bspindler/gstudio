// Measurement v2, P2 (browser-free): the toddler phase's plan is seeded, covers every gesture, and makes up exactly
// BLOCK_BARN_TODDLER_TAPS answering taps (the cancels are on top).
import { describe, expect, it, vi } from 'vitest';
import { BLOCK_BARN_TODDLER_SEEDS, BLOCK_BARN_TODDLER_TAPS } from '../../packages/core/src/hal/block-barn-score.js';

vi.mock('playwright', () => ({ chromium: { launch: vi.fn(async () => { throw new Error('no browser in unit tests'); }) } }));
const { PRESS_MS, TODDLER_SEEDS, toddlerPlan, toddlerRng } = await import('./block-barn-play.js');

const taps = (plan: ReturnType<typeof toddlerPlan>) => plan.reduce((a, s) => a + (s.gesture === 'cancel' ? 0 : s.n ?? 1), 0);

describe('toddlerPlan', () => {
  it('is the same from the same seed and differs from another seed', () => {
    expect(toddlerPlan(toddlerRng(TODDLER_SEEDS[0]!))).toEqual(toddlerPlan(toddlerRng(TODDLER_SEEDS[0]!)));
    expect(toddlerPlan(toddlerRng(TODDLER_SEEDS[1]!))).not.toEqual(toddlerPlan(toddlerRng(TODDLER_SEEDS[0]!)));
  });
  it('has every gesture: 4 runs of 3-6 taps, two fingers, palms, a 1 s press on the corner and one anywhere, 2 cancels', () => {
    for (const seed of [...TODDLER_SEEDS, 99]) {
      const plan = toddlerPlan(toddlerRng(seed));
      const count = (g: string) => plan.filter((s) => s.gesture === g).length;
      expect(count('run')).toBe(4);
      for (const r of plan.filter((s) => s.gesture === 'run')) { expect(r.n).toBeGreaterThanOrEqual(3); expect(r.n).toBeLessThanOrEqual(6); }
      expect(count('two')).toBe(3);
      expect(count('palm')).toBe(3);
      expect(plan.filter((s) => s.gesture === 'press').map((s) => !!s.corner).sort()).toEqual([false, true]);
      expect(count('cancel')).toBe(2);
      expect(taps(plan)).toBe(BLOCK_BARN_TODDLER_TAPS);
    }
  });
  it('plays BLOCK_BARN_TODDLER_SEEDS different seeds, each with a different plan', () => {
    expect(TODDLER_SEEDS).toHaveLength(BLOCK_BARN_TODDLER_SEEDS);
    expect(new Set(TODDLER_SEEDS.map((s) => JSON.stringify(toddlerPlan(toddlerRng(s))))).size).toBe(BLOCK_BARN_TODDLER_SEEDS);
  });
  it('the press is well short of the grown-up corner\'s 3 s hold', () => {
    expect(PRESS_MS).toBe(1000);
  });
  it('the generator gives numbers in [0, 1)', () => {
    const r = toddlerRng(7);
    for (let i = 0; i < 1000; i++) { const x = r(); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});
