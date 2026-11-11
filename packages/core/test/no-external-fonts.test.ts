// Browser-free guard: no game page or the shelf page may load Google Fonts (players' IPs would go to Google).
// Fonts are bundled (SIL OFL) next to each game; see scripts/*/fonts/SOURCES.md.
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..', '..');
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('no external font hosts', () => {
  const files = [...walk(join(repo, 'games')).filter((f) => ['.html', '.js', '.css'].includes(extname(f))), join(repo, 'scripts', 'site', 'index.html')];
  it('scans a real set of files', () => {
    expect(files.length).toBeGreaterThan(5);
  });
  it('mentions neither fonts.googleapis.com nor fonts.gstatic.com', () => {
    const hits = files.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(repo.length + 1));
    expect(hits).toEqual([]);
  });
});
