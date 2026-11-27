import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
const fn = () => html.slice(html.indexOf('function glanceOne('), html.indexOf('function glanceLoop('));

describe('tidepool-pals: a stranded pal glances toward its exit now and then', () => {
  it('uses a code-drawn css lean on the pal, off for reduced motion', () => {
    expect(html).toMatch(/\.lost\.glance \.tl\{animation:glance 1\.6s/);
    expect(html).toContain('@keyframes glance');
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{\.lost\.glance \.tl\{animation:none/);
  });
  it('leans toward the exit, waits for quiet, and touches no board state', () => {
    const f = fn();
    expect(f).toContain('GRAVITY[lvl.exit]');
    expect(f).toContain('motion()');
    expect(f).toContain('pressing');
    expect(f).toContain('busy');
    expect(f).toContain('.hintme');
    expect(f).not.toMatch(/grid|lvl\.moves|prog|fetch|http/);
  });
});
