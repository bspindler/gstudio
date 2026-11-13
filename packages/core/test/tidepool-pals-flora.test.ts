import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals coral and anemone flora', () => {
  it('draws code-made flora inside the pool strip, behind its content, without taking room', () => {
    expect(html).toContain('function reefFlora(');
    const css = html.match(/\.pp>\.flora\{([^}]*)\}/)![1];
    expect(css).toContain('position:absolute');
    expect(css).toContain('pointer-events:none');
    expect(css).toContain('var(--bloom');
    expect(html.match(/function renderPoolPanel\(\)\s*\{([\s\S]*?)\n\}/)![1]).toMatch(/--bloom:\$\{x\.fraction/);
  });

  it('sways gently and is switched off for reduced motion', () => {
    expect(html).toContain('@keyframes florasway');
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important/);
  });
});
