import { describe, expect, it } from 'vitest';

import { endlessLevel } from '../../../games/lanternkeep/lib/endless.js';

describe('lanternkeep: Night Watch ramp', () => {
  const waves = endlessLevel().waves as unknown as [string, number, number, number][][];

  it('keeps every wave short enough to finish, so the lantern falls instead of the clock running out', () => {
    for (const [i, w] of waves.slice(0, 40).entries()) {
      for (const [, count, gap, at] of w) expect(at + count * gap, `wave ${i + 1}`).toBeLessThan(3600);
    }
  });

  it('leaves the opening waves on the old pace and presses harder later', () => {
    for (let i = 0; i <= 14; i++) for (const [, count, gap] of waves[i]!) expect(gap).toBeGreaterThanOrEqual(0.15);
    const late = waves[50]!.reduce((n, [, c]) => n + c, 0);
    const mid = waves[14]!.reduce((n, [, c]) => n + c, 0);
    expect(late).toBeGreaterThan(mid * 10);
  });
});
