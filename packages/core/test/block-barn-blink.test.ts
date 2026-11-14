import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../../games/block-barn/${f}`, import.meta.url)), 'utf8');
const html = read('index.html');
const draw = read('draw.js');

describe('block-barn: named animals blink slowly', () => {
  it('wraps each eye so it can blink', () => {
    expect(draw).toMatch(/<g class="eye">/);
  });
  it('blinks slowly and softly, with no opacity change', () => {
    const m = html.match(/@keyframes blink \{[^]*?\}\s*\}/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/opacity/);
    const secs = Number(html.match(/\.animal\.blink \.eye \{[^}]*animation: blink (\d+(\.\d+)?)s/)![1]);
    expect(secs).toBeGreaterThanOrEqual(1);
  });
  it('is spaced several seconds apart, only for named animals', () => {
    expect(html).toMatch(/4000 \+ Math\.random\(\) \* 5000/);
    expect(html).toMatch(/named\.has\(floor\[k\]\)/);
  });
  it('never blinks under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.blink \.eye \{ animation: none/);
    expect(html).toMatch(/const reduced = matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  });
});
