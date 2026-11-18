import { describe, expect, it } from 'vitest';

import { SWELL_SECONDS, createSwell } from '../../../games/lanternkeep/swell.js';

const game = (phase: string, enemies: number, queue = 0) => ({ phase, enemies: new Array(enemies).fill(0), queue: new Array(queue).fill(0) });

describe('lanternkeep: wave-clear swell', () => {
  it('stays dark while a wave is running and swells once it is cleared', () => {
    const s = createSwell();
    expect(s.update(game('wave', 3, 2), 1)).toBe(0);
    expect(s.update(game('wave', 1), 2)).toBe(0);
    expect(s.update(game('wave', 0), 2.1)).toBe(0);
    const mid = s.update(game('wave', 0), 2.1 + SWELL_SECONDS * 0.25);
    expect(mid).toBeGreaterThan(0.9);
    expect(mid).toBeLessThanOrEqual(1);
    expect(s.update(game('wave', 0), 2.1 + SWELL_SECONDS + 0.1)).toBe(0);
  });

  it('does not swell on build phase, or when the lantern is lost', () => {
    const s = createSwell();
    expect(s.update(game('ready', 0), 1)).toBe(0);
    s.update(game('wave', 2), 2);
    expect(s.update(game('lost', 0), 2.5)).toBe(0);
    expect(s.update(game('lost', 0), 3)).toBe(0);
  });

  it('is gentler with reduced motion', () => {
    const a = createSwell(), b = createSwell();
    a.update(game('wave', 1), 1); b.update(game('wave', 1), 1);
    a.update(game('wave', 0), 2); b.update(game('wave', 0), 2);
    const t = 2 + SWELL_SECONDS * 0.25;
    expect(b.update(game('wave', 0), t, true)).toBeLessThan(a.update(game('wave', 0), t));
  });
});
