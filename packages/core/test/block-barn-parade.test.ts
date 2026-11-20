import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: barn parade through the open door', () => {
  const fn = html.slice(html.indexOf('function tapDoor('), html.indexOf('/** The tappable things'));
  it('parades once, only from an open door, never again while it runs', () => {
    expect(fn).toMatch(/doorOpen && !parading \? paradeAnimals\(\)/);
    expect(fn).toMatch(/startParade\(walkers\)/);
  });
  it('always ends: a timer clears the class and the state, and reset/leaveBarn let go', () => {
    expect(html).toMatch(/paradeTimer = setTimeout\(endParade/);
    expect(html.slice(html.indexOf('function resetDoor('))).toMatch(/^function resetDoor\(\) \{\s*endParade\(\);/);
    expect(html.slice(html.indexOf('function leaveBarn('), html.indexOf('function resetDoor('))).toMatch(/'parade'/);
  });
  it('is CSS-only, calm, and still under reduced motion', () => {
    expect(html).toMatch(/@keyframes parade/);
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.parade \{ animation: none/);
    const kf = html.slice(html.indexOf('@keyframes parade'), html.indexOf('@keyframes trot-in'));
    expect(kf).not.toMatch(/opacity/);
  });
});
