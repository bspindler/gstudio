import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: neighbours peek at each other', () => {
  it('runs on a slow timer, skipped under reduced motion, and only for named animals', () => {
    const fn = html.slice(html.indexOf('function peekLater('), html.indexOf('function hiddenFriend('));
    expect(fn).toMatch(/prefers-reduced-motion: reduce/);
    expect(fn).toMatch(/named\.has\(/);
    expect(fn).toMatch(/restart\(a, 'look'\)/);
    expect(fn).toMatch(/9000 \+ Math\.random\(\) \* 8000/);
    expect(fn).not.toMatch(/sfx\.|textContent|innerHTML/);
    expect(html).toMatch(/peekLater\(\); \}/);
  });
  it('still stays still under reduced motion via the look rule', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.look \.art \{ animation: none/);
  });
});
