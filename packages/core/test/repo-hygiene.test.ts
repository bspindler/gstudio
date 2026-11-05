import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('repo hygiene (Windows-safe)', () => {
  it('no source file derives a filesystem path from URL.pathname', () => {
    const bad = ['scripts', 'services', 'packages', 'adapters']
      .flatMap((d) => tsFiles(join(root, d)))
      .filter((f) => /new URL\([^)]*\)\.pathname/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => f.slice(root.length))).toEqual([]);
  });

  it('tracked text files use LF', () => {
    const out = execFileSync('git', ['ls-files', '--eol'], { cwd: root, encoding: 'utf8' });
    const bad = out.split('\n').filter((l) => /^i\/(crlf|mixed)\b/.test(l));
    expect(bad).toEqual([]);
  });

  it('.gitattributes forces LF', () => {
    expect(readFileSync(join(root, '.gitattributes'), 'utf8')).toContain('* text=auto eol=lf');
  });

  it('npm scripts avoid POSIX-only shell syntax', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const bad = Object.entries(pkg.scripts).filter(([, v]) => /\/dev\/null|^\w+=\S+\s|\brm -rf\b/.test(v));
    expect(bad).toEqual([]);
  });
});
