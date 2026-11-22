import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestMarkShimmer, bestMarkX } from '../../../games/hyperline/lib/ghost.js';
import { P } from '../../../games/hyperline/lib/world.js';

describe('hyperline best-run gate mark', () => {
  it('stands at the saved best distance on the track', () => {
    expect(bestMarkX(250, 1)).toBe(P + 250);
  });
  it('is absent with no saved best, on practice starts and on bad values', () => {
    expect(bestMarkX(0, 1)).toBeNull();
    expect(bestMarkX(250, 3)).toBeNull();
    expect(bestMarkX(NaN, 1)).toBeNull();
    expect(bestMarkX(-5, 1)).toBeNull();
  });
  it('shimmers only for a short stretch after the runner passes it', () => {
    expect(bestMarkShimmer(100, 110)).toBe(0);
    expect(bestMarkShimmer(110, 110)).toBe(1);
    const mid = bestMarkShimmer(114, 110);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(bestMarkShimmer(130, 110)).toBe(0);
  });
  it('is wired into the scene and the page with no new storage', () => {
    const r = readFileSync(new URL('../../../games/hyperline/render.js', import.meta.url), 'utf8');
    const h = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
    expect(r).toContain('st.bestMark');
    expect(h).toContain('bestMark:');
    expect(h).not.toMatch(/setItem\([^)]*[Mm]ark/);
  });
});
