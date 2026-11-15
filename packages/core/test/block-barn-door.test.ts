import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: tap the barn door and animals trot inside', () => {
  const fn = html.slice(html.indexOf('function tapDoor('), html.indexOf('/** The tappable things'));
  it('has big doors on the wall and a window to peek from', () => {
    expect(html).toMatch(/id="door"/);
    expect(html).toMatch(/id="peeks"/);
    expect(html).toMatch(/Math\.max\(r\.width, 88\)/);
  });
  it('routes a tap inside the door box to tapDoor, before the nearest-target search', () => {
    const tap = html.slice(html.indexOf('function tapAt('));
    expect(tap.indexOf('tapDoor()')).toBeGreaterThan(0);
    expect(tap.indexOf('tapDoor()')).toBeLessThan(tap.indexOf('hitBoxes()'));
  });
  it('sends named animals in one by one and back out on the next tap, with no score, text or timers of its own', () => {
    expect(fn).toMatch(/named\.has\(l\)/);
    expect(fn).toMatch(/i \* TROT_GAP/);
    expect(fn).toMatch(/'trot-in'/);
    expect(fn).toMatch(/'trot-out'/);
    expect(fn).not.toMatch(/textContent|score|sfx\./);
  });
  it('is still under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.trot-in \{ animation: none/);
    expect(rm).toMatch(/\.animal\.trot-out \{ animation: none/);
    expect(rm).toMatch(/#door \.leaf \{ transition: none/);
  });
  it('lets go of an animal that is inside when its block is stacked', () => {
    const fnStack = html.slice(html.indexOf('function stackBlock('), html.indexOf('function fly('));
    expect(fnStack).toMatch(/leaveBarn\(l\)/);
  });
});
