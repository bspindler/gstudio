import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: tap the sun for a starry dusk', () => {
  it('draws the sun and steady stars in code, fading over 3s, instant under reduced motion', () => {
    expect(html).toContain('id="sun"');
    expect(html).toMatch(/#sun \{[^}]*transition: opacity 3s/);
    expect(html).toMatch(/#dusk-sky::before \{[^}]*transition: opacity 3s/);
    expect(html).toMatch(/\.animal\.drowse \.eye, #sun, #dusk-sky::before \{ transition: none/);
    expect(html).not.toMatch(/#dusk-sky::before \{[^}]*animation/);
  });
  it('has its own box clear of the door, sky, loft and vane zones, one branch in tapAt and one line in tapZones', () => {
    expect(html).toMatch(/function sunBox\(\)[\s\S]*\[doorBox\(\), skyBox\(\), loftBox\(\), vaneBox\(\)\]/);
    const tap = html.slice(html.indexOf('function tapAt('));
    expect(tap.indexOf('tapSun()')).toBeGreaterThan(0);
    expect(tap.indexOf('tapSun()')).toBeLessThan(tap.indexOf('hitBoxes()'));
    expect(html).toContain("{ kind: 'sun', ...box(sunBox()) }");
  });
  it('toggles once per tap, resets on reseed, with no sound or text', () => {
    const fn = html.slice(html.indexOf('function tapSun('), html.indexOf('function tapVane('));
    expect(fn).toMatch(/sunDusk = !sunDusk/);
    expect(fn).toMatch(/function resetSun/);
    expect(fn).not.toMatch(/textContent|sfx\.|tone\(|talk\(/);
  });
});
