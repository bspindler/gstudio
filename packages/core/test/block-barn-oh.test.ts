import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: animals give an oh look when the tower tumbles', () => {
  it('is slow and gentle, with no flashing', () => {
    for (const name of ['oh-lean', 'oh-eyes']) {
      const m = html.match(new RegExp(`@keyframes ${name} \\{[^]*?\\}\\s*\\}`));
      expect(m).toBeTruthy();
      expect(m![0]).not.toMatch(/opacity|color|filter/);
    }
    expect(html).toMatch(/\.animal\.oh \.eye \{[^}]*animation: oh-eyes 2\.4s/);
  });
  it('stays still under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.oh \.art \{ animation: none/);
    expect(rm).toMatch(/\.animal\.oh \.eye \{ animation: none/);
    expect(html).toMatch(/function ohLook\(\) \{\s*if \(matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/);
  });
  it('is triggered by the tumble, for named animals only', () => {
    const fn = html.slice(html.indexOf('function ohLook'), html.indexOf('function blinkLater'));
    expect(fn).toMatch(/named\.has\(/);
    expect(fn).not.toMatch(/sfx\.|talk\(|textContent/);
    const td = html.slice(html.indexOf('function tumbleDown'), html.indexOf('function tapTower'));
    expect(td).toMatch(/ohLook\(\)/);
  });
});
