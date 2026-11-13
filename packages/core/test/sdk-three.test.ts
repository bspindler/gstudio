import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// three.js is a core library every game may use (../sdk/vendor/three.module.js). The bundle must keep its MIT license beside it (MIT's one condition) and stay free of network code.
const dir = new URL('../../../packages/sdk/vendor/', import.meta.url);
describe('sdk: vendored three.js, a core library', () => {
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

  it('games import the shared copy and never bundle their own', () => {
    const games = fileURLToPath(new URL('../../../games/', import.meta.url));
    const files = readdirSync(games, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.(html|js)$/i.test(d.name));
    let users = 0;
    for (const f of files) {
      const rel = join(f.parentPath, f.name).slice(games.length);
      const src = readFileSync(join(f.parentPath, f.name), 'utf8');
      expect(/three\.js authors|Copyright 2010-\d{4} three\.js/.test(src), `${rel} looks like a bundled three.js`).toBe(false);
      for (const m of src.matchAll(/from\s+['"]((?:[^'"]*\/)?three(?:\.module)?(?:\.min)?\.js|three)['"]/g)) {
        expect(m[1], rel).toBe('../sdk/vendor/three.module.js');
        users++;
      }
    }
    expect(users).toBeGreaterThan(0); // Lanternkeep uses it
  });
});
