import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: the morning sunbeam', () => {
  it('sits on the floor inside the play area, behind the stage', () => {
    expect(html).toMatch(/<div id="floor"><\/div>\s*<div id="sunbeam" aria-hidden="true"><\/div>\s*<div id="stage">/);
  });
  it('is ambient: no tap zone, no flashing, very slow', () => {
    expect(html).toMatch(/#sunbeam \{[^}]*pointer-events: none/);
    const kf = html.match(/@keyframes sunbeam-drift \{[^]*?\}\s*\}/)![0];
    expect(kf).not.toMatch(/opacity|color|filter/);
    expect(html).toMatch(/animation: sunbeam-drift (\d+)s ease-in-out infinite alternate/);
    expect(Number(html.match(/sunbeam-drift (\d+)s/)![1])).toBeGreaterThanOrEqual(60);
    expect(html).not.toMatch(/getElementById\('sunbeam'\)|\$\('sunbeam'\)/);
  });
  it('stays still under reduced motion and fades at dusk', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/#sunbeam::before \{ animation: none/);
    expect(html).toMatch(/\.dusk-on #sunbeam \{ opacity: 0/);
  });
});
