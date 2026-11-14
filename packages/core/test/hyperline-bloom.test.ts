import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOOM, cameraFor, createBloom } from '../../../games/hyperline/render.js';

const read = (f: string) => readFileSync(new URL(`../../../games/hyperline/${f}`, import.meta.url), 'utf8');

describe('hyperline bloom renderer', () => {
  it('imports only the shared core three.js copy', () => {
    const r = read('render.js');
    const imports = [...r.matchAll(/import\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['../sdk/vendor/three.module.js']);
    expect(r).not.toMatch(/https?:\/\//);
  });

  it('falls back to the plain 2D present when WebGL is unavailable', async () => {
    expect(BLOOM.strength).toBeGreaterThan(0);
    const out = await createBloom({ getContext: () => null, addEventListener() {} } as never, {} as never);
    expect(out).toBeNull();
    expect(read('index.html')).toMatch(/useFlat/);
  });

  it('keeps the 0.4.1 camera', () => {
    const cam = cameraFor({ rx: 10, lift: 0, flipT: 0, shakeX: 0, shakeY: 0 }, 400, 800);
    expect(cam.eye[0]).toBeCloseTo(4.4);
    expect(cam.eye[1]).toBeCloseTo(3.1);
    expect(cam.eye[2]).toBeCloseTo(2.5);
  });
});
