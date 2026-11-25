import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { drawOverlay } from '../../../games/hyperline/render.js';
import { BLOOM3D, createRenderer3d } from '../../../games/hyperline/render3d.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
const src = readFileSync(new URL('../../../games/hyperline/render3d.js', import.meta.url), 'utf8');

describe('hyperline 3D renderer (quality plan phase 2)', () => {
  it('is the default; ?r=2d keeps the 2D renderer, and a failed 3D setup falls back to it', () => {
    expect(html).toMatch(/if \(RMODE !== '2d'\) createRenderer3d\(cv, src\)\.then\(\(r\) => \{ if \(!r\) \{ use2d\(\); return; \}/);
    expect(html).toMatch(/r\.onLost\(useFlat\)/);
  });

  it('draws from the same camera and state as the 2D renderer, and never changes game state', () => {
    expect(src).toContain("import { cameraFor,");
    expect(src).not.toMatch(/\bst\.[a-zA-Z]+\s*=[^=]|\bo\.[a-zA-Z]+\s*=[^=]|\br\.[a-zA-Z]+\s*=[^=]/);
  });

  it('loads three.js from the shared vendored copy only, and resolves null without WebGL', async () => {
    expect(src).toContain("await import('../sdk/vendor/three.module.js')");
    expect(BLOOM3D.threshold).toBeGreaterThan(0);
    // No document or WebGL in node: setup fails and the caller keeps the 2D renderer.
    expect(await createRenderer3d({}, {})).toBeNull();
  });
});

describe('drawOverlay: what the 3D renderer leaves to 2D', () => {
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_t, k) => (typeof k === 'string' && k !== 'then' ? (...a: unknown[]) => { calls.push(k); return { addColorStop() {} }; } : undefined), set: () => true });
  const base = { rx: 10, lift: 0, flipT: 0, shakeX: 0, shakeY: 0, t: 0, pops: [] as unknown[], trailId: 'classic', trailPts: [], skin: { a: '#22F0FF', b: '#2B6BFF' } };

  it('clears the canvas and reports nothing to upload when there are no pops or digits', () => {
    calls.length = 0;
    expect(drawOverlay(ctx, 390, 700, base)).toBe(false);
    expect(calls).toEqual(['clearRect']);
  });

  it('draws text pops (and reports them)', () => {
    calls.length = 0;
    expect(drawOverlay(ctx, 390, 700, { ...base, pops: [{ text: 'CLOSE!', x: 14, y: 1, col: '#22F0FF', size: 18, age: 0, life: 0.9 }] })).toBe(true);
    expect(calls).toContain('fillText');
  });
});
