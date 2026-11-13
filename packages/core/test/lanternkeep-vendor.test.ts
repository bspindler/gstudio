import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The bundled three.js must keep its MIT license beside it (MIT's one condition) and stay free of network code.
const dir = new URL('../../../games/lanternkeep/vendor/', import.meta.url);
describe('lanternkeep: vendored three.js', () => {
  it('ships the MIT license with the code', () => {
    const license = readFileSync(new URL('three.LICENSE.txt', dir), 'utf8');
    expect(license).toMatch(/The MIT License/);
    expect(license).toMatch(/three\.js authors/);
    expect(readFileSync(new URL('three.module.js', dir), 'utf8').slice(0, 200)).toMatch(/MIT License/);
  });

  it('matches the pinned three version and has no network calls', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const src = readFileSync(new URL('three.module.js', dir), 'utf8');
    expect(src.slice(0, 200)).toContain(`(${pkg.devDependencies.three})`);
    for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'importScripts']) expect(src.includes(bad), bad).toBe(false);
  });
});
