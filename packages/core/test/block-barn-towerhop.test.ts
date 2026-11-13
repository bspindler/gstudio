import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: stacked animal hops softly on the tower', () => {
  it('has one small slow hop after the pop, no flashing', () => {
    expect(html).toMatch(/\.tanimal\.pop \.pic \{ animation: pop [^;]*tower-hop 1s ease-in-out \.5s;/);
    const hop = html.match(/@keyframes tower-hop \{[^]*?\}\s*\}/)![0];
    const ups = [...hop.matchAll(/translateY\(-(\d+)px\)/g)];
    expect(ups).toHaveLength(1);
    expect(Number(ups[0]![1])).toBeLessThanOrEqual(12);
    expect(hop).not.toMatch(/opacity/);
  });
  it('skips the hop under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.tanimal\.pop \.pic \{ animation: pop [^;]*;\s*\}/);
    expect(rm.match(/\.tanimal\.pop \.pic \{[^}]*\}/)![0]).not.toMatch(/tower-hop/);
  });
});
