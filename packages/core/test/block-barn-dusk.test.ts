import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: tap the sky for a slow dusk; animals nap', () => {
  const fn = html.slice(html.indexOf('function napAll('), html.indexOf('/** The tappable things'));
  it('has a code-drawn moon and a dusk tint, neither a tap target', () => {
    expect(html).toMatch(/id="moon"/);
    expect(html).toMatch(/id="dusk"[^>]*aria-hidden/);
    expect(html).toMatch(/#dusk \{[^}]*pointer-events: none/);
  });
  it('routes a tap in the window box (at least 88 wide) to tapSky, before the nearest-target search', () => {
    expect(html).toMatch(/function skyBox\(\)[\s\S]*Math\.max\(r\.width, 88\)/);
    const tap = html.slice(html.indexOf('function tapAt('));
    expect(tap.indexOf('tapSky()')).toBeGreaterThan(0);
    expect(tap.indexOf('tapSky()')).toBeLessThan(tap.indexOf('hitBoxes()'));
  });
  it('toggles dusk and naps only the named animals, with no text, score or sound', () => {
    expect(fn).toMatch(/dusk = !dusk/);
    expect(fn).toMatch(/named\.has\(l\)/);
    expect(fn).not.toMatch(/textContent|score|sfx\.|tone\(|talk\(/);
  });
  it('closes the eyes of a napping animal, slowly, and is instant under reduced motion', () => {
    expect(html).toMatch(/\.animal\.nap \.eye \{[^}]*scaleY\(\.12\)/);
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/#dusk, #dusk-sky \{ transition: none/);
    expect(rm).toMatch(/\.animal\.nap \.eye, \.animal\.nap \.art \{ transition: none/);
  });
  it('a block named at dusk naps too', () => {
    const fnRender = html.slice(html.indexOf('function renderSlot('), html.indexOf('function renderTower('));
    expect(fnRender).toMatch(/nap/);
  });
  it('is reset when the barn is reseeded', () => {
    const fnSeed = html.slice(html.indexOf('function reseed('), html.indexOf('// ---------- layout'));
    expect(fnSeed).toMatch(/resetSky/);
  });
});
