import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals: a match of 4 or more gets a bigger splash and a rounder pop', () => {
  it('has a code-drawn splash ring in the pal colour and a deeper sound', () => {
    expect(html).toContain('.splash{');
    expect(html).toContain('@keyframes splash');
    expect(html).toMatch(/bigPop\(n\)/);
  });
  it('threshold is 4 pals, for the first match and for chains', () => {
    expect(html).toContain('const BIG_MATCH = 4;');
    expect(html).toContain('function bigMatchFx(res)');
    const calls = html.match(/bigMatchFx\(res\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3); // definition + finishMove + cascade
  });
  it('is skipped for reduced motion (visual) and uses no network', () => {
    const fn = html.slice(html.indexOf('function bigMatchFx(res)'));
    expect(fn.slice(0, 900)).toContain('motion()');
    expect(fn.slice(0, 900)).not.toMatch(/fetch|http/);
  });
});
