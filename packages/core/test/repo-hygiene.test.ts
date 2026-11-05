import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

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

describe('contributor onboarding files', () => {
  it('contributor settings template is valid JSON with allow and deny lists', () => {
    const text = readFileSync(join(root, 'docs/contributor/settings.local.json.example'), 'utf8');
    const settings = JSON.parse(text) as { permissions: { allow: string[]; deny: string[] } };
    expect(settings.permissions.allow).toContain('Bash(npm test)');
    expect(settings.permissions.deny.some((r) => /^Edit\(.*policy\.yaml\)$/.test(r))).toBe(true);
    expect(settings.permissions.deny.some((r) => /git push (--force|-f)/.test(r))).toBe(true);
  });

  it('.gitignore covers personal Claude files', () => {
    const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(lines).toContain('CLAUDE.local.md');
    expect(lines).toContain('.claude/settings.local.json');
  });

  it('START-HERE references only scripts that exist', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const guide = readFileSync(join(root, 'docs/START-HERE.md'), 'utf8');
    const used = [...guide.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1] ?? '');
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((s) => !(s in pkg.scripts))).toEqual([]);
  });
});

type Workflow = { jobs: Record<string, { name?: string; if?: string; 'runs-on'?: string; 'continue-on-error'?: boolean;
  strategy?: { matrix?: { os?: string[] } }; steps?: { run?: string; with?: Record<string, unknown> }[] }> };
const workflow = (name: string) => parse(readFileSync(join(root, '.github/workflows', name), 'utf8')) as Workflow;

describe('final review fixes: setup and CI', () => {
  it('START-HERE installs Node 22 explicitly, matching .nvmrc, not "LTS"', () => {
    const guide = readFileSync(join(root, 'docs/START-HERE.md'), 'utf8');
    expect(readFileSync(join(root, '.nvmrc'), 'utf8').trim()).toBe('22');
    expect(guide).toContain('winget install OpenJS.NodeJS.22');
    expect(guide).toMatch(/choose version 22/i);
    expect(guide).not.toContain('OpenJS.NodeJS.LTS');
    expect(guide).not.toMatch(/\*\*LTS\*\* installer/);
  });

  it('CI keeps the required build jobs and adds a non-required node-lts job on Windows', () => {
    const ci = workflow('ci.yml');
    expect(ci.jobs.build?.name).toBe('build (${{ matrix.os }})');
    expect(ci.jobs.build?.strategy?.matrix?.os).toEqual(['ubuntu-latest', 'windows-latest']);
    const lts = ci.jobs['node-lts'];
    expect(lts?.['runs-on']).toBe('windows-latest');
    expect(lts?.['continue-on-error']).toBe(true);
    expect(lts?.steps?.some((s) => s.with?.['node-version'] === 'lts/*')).toBe(true);
    expect(lts?.steps?.map((s) => s.run).filter(Boolean)).toEqual(['npm ci', 'npm run typecheck', 'npm test']);
  });

  it('the Pages workflow only runs once PAGES_ENABLED is set', () => {
    const pages = workflow('pages.yml');
    for (const job of Object.values(pages.jobs)) expect(job.if).toBe("vars.PAGES_ENABLED == 'true'");
    expect(readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8')).toMatch(/#.*PAGES_ENABLED/);
  });

  it('.vscode/settings.json keeps LF line endings and is not git-ignored', () => {
    const file = join(root, '.vscode/settings.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      'files.eol': '\n', 'files.insertFinalNewline': true, 'files.trimTrailingWhitespace': true,
    });
    let ignored = true;
    try { execFileSync('git', ['check-ignore', '-q', '.vscode/settings.json'], { cwd: root }); } catch { ignored = false; }
    expect(ignored).toBe(false);
  });
});
