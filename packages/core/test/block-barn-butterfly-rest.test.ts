import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');
const fn = html.slice(html.indexOf('function butterflyRest'), html.indexOf('/** The tappable things'));

describe('block-barn: the window butterfly rests on the named animal', () => {
  it('is called once from nameBlock', () => {
    const nb = html.slice(html.indexOf('function nameBlock'), html.indexOf('const LONGPRESS'));
    expect(nb.match(/butterflyRest\(l\)/g)).toHaveLength(1);
  });
  it('is slow, once at a time, and skipped at dusk or with reduced motion', () => {
    expect(fn).toMatch(/bflyBusy \|\| dusk/);
    expect(fn).toMatch(/prefers-reduced-motion: reduce/);
    expect(fn).toMatch(/duration: 9000/);
    expect(fn).not.toMatch(/opacity/);
  });
  it('adds no sound, text or tap zone, and always returns to the window', () => {
    expect(fn).not.toMatch(/sfx\.|talk\(|textContent|addEventListener/);
    expect(fn).toMatch(/onfinish = done/);
    expect(fn).toMatch(/g\.remove\(\)/);
  });
  it('keeps the vane loop from stacking on it', () => {
    expect(html).toMatch(/if \(dusk \|\| !b\.animate \|\| bflyBusy/);
  });
});
