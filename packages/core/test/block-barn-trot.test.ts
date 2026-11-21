import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: dragging a floor animal makes it trot slowly to where you let go', () => {
  it('slides the animal slowly with a transition, no flashing', () => {
    expect(html).toMatch(/\.animal \{[^}]*transform: translateX\(var\(--dx, 0px\)\); transition: transform 2\.4s ease-in-out/);
    const m = html.match(/@keyframes trot-bob \{[^]*?\}\s*\}/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/opacity|color|filter/);
  });
  it('stays instant and still under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal \{ transition: none/);
    expect(rm).toMatch(/\.animal\.trot \.art \{ animation: none/);
  });
  it('answers once, with no sound or text, and never on a cancel', () => {
    const fn = html.slice(html.indexOf('function trotAnimal'), html.indexOf('function tapAnimal'));
    expect(fn).not.toMatch(/sfx\.|talk\(|textContent/);
    const end = html.slice(html.indexOf('function endPointer'), html.indexOf("document.addEventListener('pointerup'"));
    expect(end).toMatch(/!cancelled && !cornerOpen/);
    expect(end).toMatch(/trotAt\(/);
    expect(end.indexOf('gesture.fired = true')).toBeLessThan(end.indexOf('trotAt('));
  });
  it('only a long enough drag that began on a named animal trots; else it stays the tap', () => {
    expect(html).toMatch(/const DRAG = \d+;/);
    expect(html).toMatch(/function trotAt\(/);
    expect(html).toMatch(/b\.kind === 'animal' && distTo\(b, g\.x, g\.y\) === 0/);
  });
});
