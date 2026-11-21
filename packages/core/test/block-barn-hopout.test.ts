import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: the tapped animal hops out onto the hay and back', () => {
  it('is slow and gentle, with no flashing', () => {
    const m = html.match(/@keyframes hop-out \{[^]*?\n  \}/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/opacity|color|filter/);
    expect(html).toMatch(/\.animal\.hopout \{[^}]*animation: hop-out 3\.8s/);
  });
  it('is still under reduced motion and at dusk', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.hopout \{ animation: none/);
    const fn = html.slice(html.indexOf('function hopOut'), html.indexOf('function stackBlock'));
    expect(fn).toMatch(/prefers-reduced-motion: reduce\)'\)\.matches \|\| dusk\) return/);
  });
  it('adds no sound, text or tap zone, never restarts mid-hop, and always cleans up', () => {
    const fn = html.slice(html.indexOf('function hopOut'), html.indexOf('function stackBlock'));
    expect(fn).not.toMatch(/sfx\.|talk\(|textContent|addEventListener/);
    expect(fn).toMatch(/classList\.contains\('hopout'\)\) return/);
    expect(fn).toMatch(/classList\.remove\('hopout'\)/);
    expect(html).toMatch(/animal\.classList\.remove\('hopout'\); animal\._hopTok/);
  });
  it('runs after the name is spoken, from the tap on a named animal only', () => {
    expect(html).toMatch(/talk\(nameLines\(l\)\);\s*react\(l\);\s*hopOut\(l\);/);
  });
});
