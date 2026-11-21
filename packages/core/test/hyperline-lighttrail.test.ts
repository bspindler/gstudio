import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIGHT_TRAIL_LIFE, lightTrailAlpha } from '../../../games/hyperline/render.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');

describe('hyperline runner light trail', () => {
  it('fades from bright to nothing within a beat', () => {
    expect(LIGHT_TRAIL_LIFE).toBeLessThanOrEqual(0.5);
    expect(lightTrailAlpha(0)).toBeGreaterThan(0.3);
    expect(lightTrailAlpha(0)).toBeLessThanOrEqual(1);
    expect(lightTrailAlpha(LIGHT_TRAIL_LIFE / 2)).toBeLessThan(lightTrailAlpha(0));
    expect(lightTrailAlpha(LIGHT_TRAIL_LIFE)).toBe(0);
    expect(lightTrailAlpha(LIGHT_TRAIL_LIFE * 3)).toBe(0);
  });
  it('is render-side only, kept short, and honours reduced motion', () => {
    expect(html).toMatch(/G\.lightTrail\s*=/);
    expect(html).toMatch(/lightTrail:\s*reduced \? \[\] : G\.lightTrail/);
  });
});
