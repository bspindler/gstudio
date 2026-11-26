import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: a tapped animal stretches sleepily at dusk', () => {
  const fn = html.slice(html.indexOf('function duskStretch('), html.indexOf('function stackBlock('));
  it('is started from tapAnimal, after the usual name', () => {
    const tap = html.slice(html.indexOf('function tapAnimal('), html.indexOf('function duskStretch('));
    expect(tap.indexOf('talk(nameLines(l))')).toBeLessThan(tap.indexOf('duskStretch(l)'));
  });
  it('only at either dusk, never under reduced motion, with no sound or text', () => {
    expect(fn).toMatch(/dusk \|\| sunDusk/);
    expect(fn).toMatch(/prefers-reduced-motion/);
    expect(fn).not.toMatch(/textContent|sfx\.|tone\(|talk\(/);
  });
  it('moves only eyes and art, slowly, and is off under reduced motion', () => {
    expect(html).toMatch(/\.animal\.dusk-stretch \.art \{[^}]*animation: dusk-stretch 2\.6s/);
    expect(html).toMatch(/\.animal\.dusk-stretch \.eye \{[^}]*animation: dusk-eyes 2\.6s/);
    expect(html).toMatch(/\.animal\.dusk-stretch \.art, \.animal\.dusk-stretch \.eye \{ animation: none/);
  });
});
