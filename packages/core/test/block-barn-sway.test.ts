import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: the found animal gives a slow happy sway', () => {
  it('is slow and gentle, with no flashing', () => {
    const m = html.match(/@keyframes happy-sway \{[^]*?\}\s*\}/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/opacity|color|filter/);
    expect(html).toMatch(/\.animal\.sway \.art \{[^}]*animation: happy-sway 3s/);
  });
  it('stays still under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.sway \.art \{ animation: none/);
    expect(html).toMatch(/function happySway\(l\) \{\s*if \(matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/);
  });
  it('runs only for the invited animal, with no sound or text', () => {
    const fn = html.slice(html.indexOf('function happySway'), html.indexOf('function blinkLater'));
    expect(fn).not.toMatch(/sfx\.|talk\(|textContent/);
    expect(html).toMatch(/if \(wasInvited && wasInvited === l && floor\.includes\(l\)\) \{[^]*?happySway\(l\);/);
  });
});
