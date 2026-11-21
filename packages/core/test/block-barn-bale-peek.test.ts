import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: tap the hay bale and an animal peeks out from behind it', () => {
  const fn = html.slice(html.indexOf('function baleBox('), html.indexOf('// ---------- the barn doors'));
  it('draws the peeking animal behind the bale, not as a tap target', () => {
    expect(html.indexOf('id="bale-peek"')).toBeLessThan(html.indexOf('id="bale-bump"'));
    expect(html).toMatch(/#tower \.bpeek \{[^}]*pointer-events: none/);
  });
  it('reuses the animal drawing and the bale squash, with no text, sound or timers beyond the peek', () => {
    expect(fn).toMatch(/animalSVG\(l\)/);
    expect(fn).toMatch(/restart\(\$\('bale-bump'\), 'squash'\)/);
    expect(fn).not.toMatch(/textContent|score|sfx\.|tone\(|talk\(/);
  });
  it('is routed in tapAt only for a bare bale, before the nearest-target search, and listed in tapZones', () => {
    const tap = html.slice(html.indexOf('function tapAt('));
    expect(tap.indexOf('tapBale()')).toBeGreaterThan(0);
    expect(tap.indexOf('tapBale()')).toBeLessThan(tap.indexOf('hitBoxes()'));
    expect(tap).toMatch(/const bb = baleBox\(\);\s*\n\s*if \(bb && !tower\.blocks\(\)\.length/);
    const zones = html.slice(html.indexOf('function tapZones('), html.indexOf('function distTo('));
    expect(zones).toMatch(/kind: 'bale'/);
  });
  it('is calm under reduced motion and reset on reseed', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.bpeek\.show \{ animation: bale-peek-still/);
    const fnSeed = html.slice(html.indexOf('function reseed('), html.indexOf('// ---------- layout'));
    expect(fnSeed).toMatch(/resetBale/);
  });
});
