import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { EVENT_NAMES, complianceViolations, gameSources } from '../src/index.js';

// Static checks on every game in games/ for the hard rules that can be seen in source.
const GAMES = readdirSync(new URL('../../../games/', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`../../../games/${d.name}/index.html`, import.meta.url)))
  .map((d) => d.name);
const src = (slug: string) => readFileSync(new URL(`../../../games/${slug}/index.html`, import.meta.url), 'utf8');

describe.each(GAMES)('%s compliance', (slug) => {
  it('breaks no compliance rule (every .html and .js file)', () => {
    const meta = parse(readFileSync(new URL(`../../../games/${slug}/game.yaml`, import.meta.url), 'utf8')) as { childDirected?: boolean };
    const sources = gameSources(fileURLToPath(new URL(`../../../games/${slug}/`, import.meta.url)));
    expect(complianceViolations(sources, { childDirected: meta.childDirected === true })).toEqual([]);
  });

  it('has inline module scripts that parse (catches duplicate declarations after merges)', () => {
    const scripts = [...src(slug).matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
    const dir = mkdtempSync(join(tmpdir(), `game-${slug}-`));
    scripts.forEach((code, i) => {
      const file = join(dir, `inline-${i}.mjs`);
      writeFileSync(file, code);
      expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }), `${slug} inline script ${i}`).not.toThrow();
    });
  });

  it('tracks only event names the ingest accepts (an unknown name rejects the whole batch)', () => {
    const names = [...gameSources(fileURLToPath(new URL(`../../../games/${slug}/`, import.meta.url))).matchAll(/\.track\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    for (const n of names) expect(EVENT_NAMES, `${slug} tracks '${n}'`).toContain(n);
  });
});

describe('tidepool-pals: no paid path to a random reward (review I2)', () => {
  const html = src('tidepool-pals');
  const fn = (name: string) => html.slice(html.indexOf(`function ${name}(`), html.indexOf('\n}', html.indexOf(`function ${name}(`)));

  it('marks a level as assisted when extra moves are added (paid or pearls)', () => {
    expect(fn('addMoves')).toMatch(/lvl\.assisted\s*=\s*true/);
  });

  it('only offers the shell on unassisted wins', () => {
    const win = fn('win');
    expect(win).toContain('win-shell');
    expect(win).toMatch(/!lvl\.assisted\s*\?[^]*win-shell/);
    expect(html).toMatch(/case 'win-shell':\s*if\s*\(lvl\.assisted\)\s*break;/);
  });
});
