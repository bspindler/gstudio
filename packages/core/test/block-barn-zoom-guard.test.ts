import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/block-barn/index.html', import.meta.url), 'utf8');

// 2026-11-16: on an iPhone (Pages build) a toddler's taps and palms kept zooming the page into one or two blocks, with
// touch-action: none on the barn and a gesturestart guard already in place. iOS Safari needs every layer below.
describe('block-barn zoom guard', () => {
  it('the viewport cannot be scaled', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*maximum-scale=1[^"]*user-scalable=no/);
  });
  it('the whole page, not only the barn, refuses browser touch gestures', () => {
    expect(html.match(/html, body \{([^}]*)\}/)![1]).toContain('touch-action: none');
    expect(html.match(/#barn \{([^}]*)\}/)![1]).toContain('touch-action: none');
  });
  it('pinch is stopped by a non-passive two-finger touchmove guard and the gesture events', () => {
    expect(html).toMatch(/addEventListener\('touchmove', \(e\) => \{ if \(e\.touches\.length > 1\) e\.preventDefault\(\); \}, \{ passive: false \}\)/);
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) expect(html).toContain(`'${ev}'`);
  });
  it('a quick second tap on the barn cannot double-tap zoom', () => {
    expect(html).toMatch(/addEventListener\('touchend', [\s\S]{0,200}closest\('#barn'\)[\s\S]{0,120}preventDefault\(\)[\s\S]{0,60}\{ passive: false \}\)/);
    expect(html).toContain("addEventListener('dblclick', (e) => e.preventDefault()");
  });
});
