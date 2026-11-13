// Builds the GitHub Pages test-build site into _site/: every game, noindex, no ingest, "test build" badge.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { complianceViolations, gameSources, loadGameLibrary, pagesGameHtml, pagesIndexHtml } from '@studio/core';
import { gamesDir, repo } from './local-env.js';

const out = join(repo, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const games = await loadGameLibrary(gamesDir);
for (const g of games) {
  const src = join(gamesDir, g.slug);
  const problems = complianceViolations(gameSources(src), { childDirected: g.childDirected === true });
  if (problems.length > 0) throw new Error(`${g.slug} is not compliant:\n- ${problems.join('\n- ')}`);
  const dest = join(out, g.slug);
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name !== 'index.html' && name !== 'CHANGELOG.md') cpSync(join(src, name), join(dest, name), { recursive: true });
  }
  writeFileSync(join(dest, 'index.html'), pagesGameHtml(readFileSync(join(src, 'index.html'), 'utf8')));
}

mkdirSync(join(out, 'sdk'), { recursive: true });
cpSync(join(repo, 'packages', 'sdk', 'studio-sdk.js'), join(out, 'sdk', 'studio-sdk.js'));
writeFileSync(join(out, 'index.html'), pagesIndexHtml(games));
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Built ${games.length} game(s) into ${out}`);
