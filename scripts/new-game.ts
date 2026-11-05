// npm run new-game <slug>: copies the starter game into games/<slug>/ and fills in its name.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillTemplate, titleFromSlug, validateSlug } from '@studio/core';
import { gamesDir } from './local-env.js';

const templates = fileURLToPath(new URL('./templates/game/', import.meta.url));
const slug = process.argv[2] ?? '';
const existing = existsSync(gamesDir) ? readdirSync(gamesDir) : [];

const error = validateSlug(slug, existing);
if (error) {
  console.error(error);
  process.exit(1);
}

const vars = { slug, title: titleFromSlug(slug) };
const dir = join(gamesDir, slug);
mkdirSync(dir, { recursive: true });
for (const file of ['index.html', 'game.yaml']) {
  writeFileSync(join(dir, file), fillTemplate(readFileSync(join(templates, file), 'utf8'), vars));
}

console.log(`Made your new game "${vars.title}" in games/${slug}/

Next steps:
  1. npm run dev
  2. Open http://localhost:5174/${slug}/ in your browser
  3. Edit games/${slug}/index.html (look for the CHANGE ME comments), save, and refresh the page`);
