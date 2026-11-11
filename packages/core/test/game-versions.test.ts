import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every game's version lives in three places that must agree: game.yaml, the createStudio({ version })
// call that tags telemetry, and the newest heading in CHANGELOG.md. Any change that ships bumps all three.
const gamesDir = fileURLToPath(new URL('../../../games/', import.meta.url));
const games = readdirSync(gamesDir).filter((d) => existsSync(join(gamesDir, d, 'game.yaml')));
const SEMVER = /^\d+\.\d+\.\d+$/;

describe('game versions', () => {
  it('finds the games', () => {
    expect(games.length).toBeGreaterThanOrEqual(3);
  });

  it.each(games)('%s: game.yaml, createStudio and CHANGELOG.md agree', (slug) => {
    const read = (f: string) => readFileSync(join(gamesDir, slug, f), 'utf8');
    const yaml = read('game.yaml').match(/^version:\s*(\S+)\s*$/m)?.[1];
    expect(yaml, 'game.yaml version').toMatch(SEMVER);
    const sdk = read('index.html').match(new RegExp(`createStudio\\(\\{[^}]*game: '${slug}', version: '([^']+)'`))?.[1];
    expect(sdk, 'createStudio version').toBe(yaml);
    expect(existsSync(join(gamesDir, slug, 'CHANGELOG.md')), 'CHANGELOG.md exists').toBe(true);
    const versions = [...read('CHANGELOG.md').matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]!);
    expect(versions[0], 'newest CHANGELOG entry').toBe(yaml);
    const key = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
    for (let i = 1; i < versions.length; i++) expect(key(versions[i - 1]!), `${versions[i - 1]} after ${versions[i]}`).toBeGreaterThan(key(versions[i]!));
  });
});
