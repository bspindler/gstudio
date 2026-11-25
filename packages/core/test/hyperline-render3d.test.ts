import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { drawOverlay } from '../../../games/hyperline/render.js';
import { BLOOM3D, createRenderer3d } from '../../../games/hyperline/render3d.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
const src = readFileSync(new URL('../../../games/hyperline/render3d.js', import.meta.url), 'utf8');

describe('hyperline 3D renderer (quality plan phase 2)', () => {
  it('is the default; ?r=2d keeps the 2D renderer, and a failed 3D setup falls back to it', () => {
    expect(html).toMatch(/if \(RMODE !== '2d'\) createRenderer3d\(cv, src, \{ body: S\.body \}\)\.then\(\(r\) => \{ if \(!r\) \{ use2d\(\); return; \}/);
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

describe('hyperline art pass (quality plan phase 3, docs/hyperline/style-guide.md)', async () => {
  const { STYLE, THEMES, themeAt } = await import('../../../games/hyperline/render3d.js');
  const { SECTORS, SECTOR_LEN } = await import('../../../games/hyperline/lib/world.js');

  it('colour has meaning: safe cyan, hazards magenta or red, rewards gold', () => {
    expect(STYLE).toMatchObject({ safe: '#22F0FF', hazard: '#FF2BD6', live: '#FF2B5E', gold: '#FFE45C' });
  });

  it('the playfield uses only the style colours (no stray obstacle colours from the old palette)', () => {
    const play = src.slice(src.indexOf('// track segments between pits'), src.indexOf('// ghost:'));
    expect(play).not.toMatch(/'#(?:FF8A3D|7CFF6B|7CFFEA|FFE45C|FF2B5E)'/i);
    expect(play).not.toMatch(/pal\.(?:block|neon|rail)/);
    for (const k of ['SAFE', 'HAZ', 'LIVE', 'GOLD']) expect(play).toContain(k);
  });

  it('every sector has a theme, in order: Neon District, Flip City, Hypercore', () => {
    const names = SECTORS.map((_: unknown, i: number) => themeAt(i * SECTOR_LEN + 1).name);
    expect(names[0]).toBe('Neon District');
    expect(names[7]).toBe('Flip City');
    expect(names[14]).toBe('Hypercore');
    expect(names.at(-1)).toBe('Hypercore');
    expect(THEMES.flatMap((t: { words: string[] }) => t.words).every((w: string) => /^[A-Z0-9/]+$/.test(w))).toBe(true);
  });

  it('locker and shop thumbnails use the hero once the 3D renderer is up, and fall back to shapes when it is lost', () => {
    expect(html).toMatch(/setThumbRenderer\(r\.thumb\); paintThumbs\(document\)/);
    expect(html).toMatch(/r\.onLost\(\(\) => \{ setThumbRenderer\(null\); useFlat\(\); \}\)/);
    expect(html).not.toContain('hex prism');
  });
});

describe('hyperline street row: Downtown City MegaKit buildings (Brian, 2026-11-25)', async () => {
  const { CITY, CITY_LOT } = await import('../../../games/hyperline/render3d.js');
  it('three buildings, each lean (no interiors or ornamental trim) and with real glass for the windows', async () => {
    expect(Object.keys(CITY)).toEqual(['large', 'medium', 'small']);
    for (const load of Object.values(CITY)) {
      const data = (await load()).default as { tris: number; meshes: { prims: { mat: string }[] }[] };
      const mats = data.meshes.flatMap((m) => m.prims.map((p) => p.mat));
      expect(data.tris).toBeLessThan(8000);
      expect(mats.some((m) => /glass/i.test(m))).toBe(true);
      expect(mats.some((m) => /interior/i.test(m))).toBe(false);
    }
  });

  it('lots line both sides of the track, from just behind the camera to the fog; whole windows light together', () => {
    expect(CITY_LOT).toBeGreaterThan(10);
    expect(src).toMatch(/const l0 = Math\.floor\(\(rx - 12\) \/ CITY_LOT\), l1 = Math\.floor\(\(rx \+ 100\) \/ CITY_LOT\)/);
    expect(src).toMatch(/for \(const side of \[-1, 1\]\)/);
    expect(src).toMatch(/function paneRandoms\(g\)/);
  });
});
