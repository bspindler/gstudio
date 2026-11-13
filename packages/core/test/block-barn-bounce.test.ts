import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: tumbled blocks bounce once softly', () => {
  const fall = html.match(/@keyframes fall \{[^]*?\}\s*\}/)![0];
  it('has one small eased bounce and no flashing', () => {
    const ups = [...fall.matchAll(/var\(--dy\) - (\d+)px/g)];
    expect(ups).toHaveLength(1);
    expect(Number(ups[0]![1])).toBeLessThanOrEqual(16);
    expect(fall).toMatch(/animation-timing-function/);
    expect(fall).not.toMatch(/scale/);
  });
  it('skips the bounce under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.falling \{ animation-name: fall-calm/);
    const calm = html.match(/@keyframes fall-calm \{[^]*?\}\s*\}/)![0];
    expect(calm).not.toMatch(/- \d+px/);
  });
});
