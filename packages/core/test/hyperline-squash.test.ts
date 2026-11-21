import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { squashScale } from '../../../games/hyperline/render.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');

describe('hyperline runner squash and stretch', () => {
  it('is neutral at rest', () => {
    expect(squashScale(0)).toEqual({ sx: 1, sy: 1 });
  });
  it('stretches tall on take-off and flattens on landing, keeping it small', () => {
    const up = squashScale(-1), down = squashScale(1);
    expect(up.sy).toBeGreaterThan(1);
    expect(up.sx).toBeLessThan(1);
    expect(down.sy).toBeLessThan(1);
    expect(down.sx).toBeGreaterThan(1);
    for (const s of [up, down]) {
      expect(s.sy).toBeGreaterThan(0.6);
      expect(s.sy).toBeLessThan(1.4);
    }
  });
  it('clamps out-of-range input', () => {
    expect(squashScale(9)).toEqual(squashScale(1));
    expect(squashScale(-9)).toEqual(squashScale(-1));
  });
  it('is driven from the render side only and honours reduced motion', () => {
    expect(html).toMatch(/G\.squash\s*=/);
    expect(html).toMatch(/squash:\s*reduced \? 0 : G\.squash/);
  });
});
