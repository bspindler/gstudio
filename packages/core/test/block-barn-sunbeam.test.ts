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
    // still no tap zone: the script may only read the beam's animation (warmLater), never listen to it
    expect(html).not.toMatch(/(getElementById\('sunbeam'\)|\$\('sunbeam'\))\s*\.\s*(addEventListener|on\w+\s*=)/);
  });
  it('gently closes the eyes of the one named animal the beam is over (warm), distinct from napAll', () => {
    const fn = html.slice(html.indexOf('function warmLater('), html.indexOf('function hiddenFriend('));
    expect(fn).toMatch(/prefers-reduced-motion: reduce/);
    expect(fn).toMatch(/dusk/);
    expect(fn).toMatch(/named\.has/);
    expect(fn).not.toMatch(/sfx\.|talk\(|Math\.random|\.nap\b/);
    expect(html).toMatch(/\.animal\.warm \.eye \{[^}]*scaleY\(\.3\)[^}]*transition: transform 3\.5s/);
    expect(html).toMatch(/\.animal\.warm \.eye \{ transition: none; \}/);
    expect(html).toMatch(/peekLater\(\); \}\s*warmLater\(\);/);
  });
  it('stays still under reduced motion and fades at dusk', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/#sunbeam::before \{ animation: none/);
    expect(html).toMatch(/\.dusk-on #sunbeam \{ opacity: 0/);
  });
});
