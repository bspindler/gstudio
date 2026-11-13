import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGameLibrary, validateSlug } from '../src/index.js';

const lib = (games: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'lib-'));
  for (const [slug, yaml] of Object.entries(games)) {
    mkdirSync(join(dir, slug));
    writeFileSync(join(dir, slug, 'game.yaml'), yaml);
    writeFileSync(join(dir, slug, 'index.html'), '<!doctype html>');
  }
  return dir;
};
const yaml = (slug: string, extra = '') =>
  `slug: ${slug}\ntitle: T\ngenre: puzzle\ntargetSegment: casual 13+\nversion: 0.2.0\nageRating: null\n${extra}`;

describe('loadGameLibrary', () => {
  it('loads every game folder sorted by slug', async () => {
    const games = await loadGameLibrary(lib({ zeta: yaml('zeta'), alpha: yaml('alpha') }));
    expect(games.map((g) => g.slug)).toEqual(['alpha', 'zeta']);
    expect(games[0]).toMatchObject({ title: 'T', genre: 'puzzle', version: '0.2.0', ageRating: null });
  });

  it('rejects a slug that does not match its folder', async () => {
    await expect(loadGameLibrary(lib({ alpha: yaml('beta') }))).rejects.toThrow(/alpha.*slug/);
  });

  it('rejects unknown keys', async () => {
    await expect(loadGameLibrary(lib({ alpha: yaml('alpha', 'odds: hidden\n') }))).rejects.toThrow(/odds/);
  });

  it('accepts childDirected: true', async () => {
    const games = await loadGameLibrary(lib({ alpha: yaml('alpha', 'childDirected: true\n') }));
    expect(games[0]?.childDirected).toBe(true);
  });

  it('rejects a non-boolean childDirected', async () => {
    await expect(loadGameLibrary(lib({ alpha: yaml('alpha', 'childDirected: "yes"\n') }))).rejects.toThrow(/childDirected/);
  });

  it('loads the real library', async () => {
    // Contributors add their own games here, so check the known ones are present rather than an exact list.
    const dir = fileURLToPath(new URL('../../../games', import.meta.url));
    const games = await loadGameLibrary(dir);
    expect(games.map((g) => g.slug)).toEqual(expect.arrayContaining(['hyperline', 'tidepool-pals']));
    const folders = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(games.map((g) => g.slug).sort()).toEqual(folders.sort());
    for (const g of games) expect(validateSlug(g.slug, [])).toBeNull();
  });
});
