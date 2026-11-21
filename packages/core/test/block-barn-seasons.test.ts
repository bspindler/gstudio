import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: tap the loft window for slow seasons', () => {
  it('has four code-drawn season layers that cross-fade over 3s, still under reduced motion', () => {
    for (const k of [0, 1, 2, 3]) expect(html).toContain(`class="sv sv${k}"`);
    expect(html).toMatch(/#loft \.sv \{[^}]*transition: opacity 3s/);
    expect(html).toMatch(/#loft \.sv \{ transition: none/);
  });
  it('has its own box, one branch in tapAt before the nearest-target search, and one line in tapZones', () => {
    expect(html).toMatch(/function loftBox\(\)/);
    const tap = html.slice(html.indexOf('function tapAt('));
    expect(tap.indexOf('tapLoft()')).toBeGreaterThan(0);
    expect(tap.indexOf('tapLoft()')).toBeLessThan(tap.indexOf('hitBoxes()'));
    expect(html).toContain("{ kind: 'loft', ...box(loftBox()) }");
  });
  it('keeps clear of the sky and door zones, and the vane steps around it', () => {
    expect(html).toMatch(/function loftBox\(\)[\s\S]*widestFree\(\[d, \.\.\.\(sk \? \[sk\] : \[\]\)\]\)/);
    expect(html).toMatch(/function vaneBox\(\)[\s\S]*loftBox\(\)/);
  });
  it('advances one season per tap, with no sound, text or count; the butterfly loop is untouched', () => {
    const fn = html.slice(html.indexOf('function tapLoft('), html.indexOf('/** The tappable things'));
    expect(fn).toMatch(/season = \(season \+ 1\) % 4/);
    expect(fn.slice(0, fn.indexOf('let bflyLoop'))).not.toMatch(/textContent|sfx\.|tone\(|talk\(/);
    expect(html).toMatch(/function tapVane\(\)[\s\S]*butterflyLoop\(\)/);
  });
});
