import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals: goal counter bounces when a clear counts', () => {
  it('uses a code-drawn bounce with a glow in the pal colour, off for reduced motion', () => {
    expect(html).toContain('@keyframes goalbounce');
    expect(html).toMatch(/\.gchip\.bump \.gi\{animation:goalbounce/);
    expect(html).toContain('var(--gc,');
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{\.gchip\.bump/);
  });
  it('bumps only when progress rose, and passes the tile colour for collect goals', () => {
    expect(html).toContain('lastGot[i] < g.got ? \' bump\'');
    expect(html).toContain('--gc:${TC[g.c][0]}');
  });
});
