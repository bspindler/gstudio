import { describe, expect, it } from 'vitest';
import { pagesGameHtml, pagesIndexHtml, type GameMeta } from '../src/index.js';

const game = '<!doctype html><html><head><meta charset=utf8></head><body><script type="module">x()</script></body></html>';
const count = (s: string, needle: string) => s.split(needle).length - 1;

const meta = (slug: string, title: string): GameMeta =>
  ({ slug, title, genre: 'puzzle', targetSegment: 'casual', version: '0.1.0', ageRating: null });

describe('pagesGameHtml', () => {
  it('adds one noindex meta, one badge and the no-ingest config', () => {
    const out = pagesGameHtml(game);
    expect(count(out, '<meta name="robots" content="noindex">')).toBe(1);
    expect(count(out, 'id="studio-test-badge"')).toBe(1);
    expect(out).toContain('test build</div>');
    expect(count(out, "window.STUDIO_CONFIG={endpoint:''}")).toBe(1);
    expect(out.indexOf('STUDIO_CONFIG')).toBeLessThan(out.indexOf('<script type="module">'));
    expect(out.indexOf('studio-test-badge')).toBeLessThan(out.indexOf('</body>'));
  });
  it('is idempotent', () => {
    const once = pagesGameHtml(game);
    expect(pagesGameHtml(once)).toBe(once);
  });
});

describe('pagesIndexHtml', () => {
  it('lists every game with relative links, noindex, and escapes titles', () => {
    const out = pagesIndexHtml([meta('a-game', 'Alpha'), meta('b-game', '<b>Bold</b>')]);
    expect(out).toContain('<title>Test builds</title>');
    expect(out).toContain('<meta name="robots" content="noindex">');
    expect(out).toContain('<a href="./a-game/">Alpha</a>');
    expect(out).toContain('<a href="./b-game/">&lt;b&gt;Bold&lt;/b&gt;</a>');
    expect(out).not.toContain('<b>Bold');
    expect(out).toMatch(/nothing is collected/i);
  });
});
