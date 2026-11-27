import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: the block wobbles softly when its animal trots home', () => {
  const start = html.indexOf('function welcomeHome(');
  const fn = html.slice(start, html.indexOf('\n}\n', start));
  it('exists and is silent, textless, calm and off under reduced motion', () => {
    expect(start).toBeGreaterThan(0);
    expect(fn).toMatch(/prefers-reduced-motion/);
    expect(fn).not.toMatch(/textContent|sfx\.|tone\(|talk\(|createElement/);
  });
  it('is a slow, small wobble of the block body only (no tap zone, no toy moves)', () => {
    expect(html).toMatch(/\.body\.welcome \{[^}]*animation: welcome-wobble 1\.6s/);
    expect(html).toMatch(/\.body\.welcome \{ animation: none/);
    const kf = html.slice(html.indexOf('@keyframes welcome-wobble'), html.indexOf('@keyframes welcome-wobble') + 200);
    expect(kf).toMatch(/rotate\(/);
    expect(kf).not.toMatch(/translate|opacity|filter|brightness/);
  });
  it('is called when the trot, the piggyback ride and the door visit end', () => {
    expect(html.slice(html.indexOf('function trotAnimal('), html.indexOf('function rideAnimal('))).toMatch(/welcomeHome\(l/);
    expect(html.slice(html.indexOf('function rideAnimal('), html.indexOf('function tapAnimal('))).toMatch(/welcomeHome\(rl/);
    expect(html.slice(html.indexOf('function visitLoft('), html.indexOf('function leaveBarn('))).toMatch(/welcomeHome\(l/);
  });
});
