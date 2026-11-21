import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
const fn = () => html.slice(html.indexOf('function blinkOne('), html.indexOf('function blinkLoop('));

describe('tidepool-pals: board pals give an occasional soft blink', () => {
  it('squashes the eyes only, with a code-drawn css animation', () => {
    expect(html).toContain('<g class="eyes">');
    expect(html).toContain('@keyframes blink');
    expect(html).toMatch(/\.tile\.blink \.eyes\{[^}]*animation:blink/);
  });
  it('skips drags, clears, hints, aiming and reduced motion, and touches no board state', () => {
    expect(fn()).toContain('motion()');
    expect(fn()).toContain('pressing');
    expect(fn()).toContain('busy');
    expect(fn()).toContain('.hintme');
    expect(fn()).not.toMatch(/grid|lvl\.moves|prog|fetch|http/);
  });
});
