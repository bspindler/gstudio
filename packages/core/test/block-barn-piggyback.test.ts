import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: an animal dropped on another rides piggyback, then hops off', () => {
  const fn = html.slice(html.indexOf('function rideAnimal'), html.indexOf('function tapAnimal'));
  it('uses only translate, no sound, text, opacity or colour, and ends back home', () => {
    expect(fn).not.toMatch(/sfx\.|talk\(|textContent|opacity|filter|color/);
    expect(fn).toMatch(/translate: P\(0, 0\) \}/);
    expect(fn).not.toMatch(/--dx|tower|floor\[/);
  });
  it('does nothing under reduced motion and is not stacked while running', () => {
    expect(fn).toMatch(/prefers-reduced-motion: reduce/);
    expect(fn).toMatch(/playState === 'running'/);
  });
  it('is routed from the drag-drop only, after the cancel guard, and falls back to the trot', () => {
    const at = html.slice(html.indexOf('function trotAt'), html.indexOf('function endPointer'));
    expect(at).toMatch(/o\.kind === 'animal' && o\.letter !== b\.letter && distTo\(o, x, y\) === 0/);
    expect(at).toMatch(/rideAnimal\(b\.letter, host\.letter\)/);
    expect(at).toMatch(/trotAnimal\(b\.letter, x\)/);
    const end = html.slice(html.indexOf('function endPointer'), html.indexOf("document.addEventListener('pointerup'"));
    expect(end).toMatch(/!cancelled && !cornerOpen/);
  });
});
