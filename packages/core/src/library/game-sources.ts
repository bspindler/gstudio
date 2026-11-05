// Everything a game ships that compliance must see: every .html and .js file in its folder.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Concatenates every *.html and *.js file under `dir`, recursively, separated by newlines.
 * Files are ordered by their '/'-separated relative path (plain code-point order), so the
 * result is the same on every OS.
 */
export function gameSources(dir: string): string {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(html|js)$/i.test(d.name))
    .map((d) => {
      const abs = join(d.parentPath, d.name);
      return { abs, rel: relative(dir, abs).replace(/\\/g, '/') };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return files.map((f) => readFileSync(f.abs, 'utf8')).join('\n');
}
