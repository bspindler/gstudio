// collectDiff against a real temp git repo (no vitest-in-vitest: the test counter is injected).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkTripwires } from '@studio/core/hal';
import { collectDiff, countArrayItems, runGit, type GitRunner } from './git.js';

const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string | Buffer) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };

const GEAR = (n: number) => `export const WALLS = '#';\nexport const LEVELS = [\n${Array.from({ length: n }, (_, i) => `  { name: 'L${i}', map: ['#S#', '#X#'] },`).join('\n')}\n];\n`;
const TIDE = (n: number) => `const L = (n) => ({ n });\nconst RAW = [\n${Array.from({ length: n }, (_, i) => `  L(${i + 1}),`).join('\n')}\n];\nexport const AUTHORED = RAW.map((d) => d);\n`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]);

describe('countArrayItems', () => {
  it('counts top-level items, ignoring nesting, strings, comments and a trailing comma', () => {
    const src = `const LEVELS = [\n  { a: [1, 2], s: "x, ]" }, // one, two\n  L(2, [3, 4]),\n  /* ], */ 'q,',\n  \`t, \${1}\`,\n];`;
    expect(countArrayItems(src, 'LEVELS')).toBe(4);
  });
  it('handles no trailing comma, empty, missing, and unclosed arrays', () => {
    expect(countArrayItems('export const LEVELS = [1, 2, 3];', 'LEVELS')).toBe(3);
    expect(countArrayItems('export const LEVELS = [];', 'LEVELS')).toBe(0);
    expect(countArrayItems('const OTHER = [1];', 'LEVELS')).toBeNull();
    expect(countArrayItems('const LEVELS = [1, 2', 'LEVELS')).toBeNull();
    expect(countArrayItems('const MYLEVELS = [1, 2]', 'LEVELS')).toBeNull();
  });
  it('reads the real games: Tidepool has its 20 hand-authored levels, Gearhold its map list', () => {
    const real = (f: string) => readFileSync(new URL(`../../games/${f}`, import.meta.url), 'utf8');
    expect(countArrayItems(real('tidepool-pals/levels.js'), 'RAW')).toBe(20);
    const gear = real('gearhold/levels.js');
    expect(countArrayItems(gear, 'LEVELS')).toBe((gear.match(/^ {4}name: /gm) ?? []).length);
    expect(countArrayItems(gear, 'LEVELS')).toBeGreaterThanOrEqual(3);
  });
});

describe('collectDiff (temp git repo)', () => {
  let root: string, base: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'hal-git-'));
    gitIn(root, 'init', '-q', '-b', 'main');
    put(root, 'games/gearhold/levels.js', GEAR(3));
    put(root, 'games/tidepool-pals/levels.js', TIDE(4));
    put(root, 'games/g/a.js', 'let a = 1;\nlet b = 2;\n');
    put(root, 'games/g/old-name.js', 'one\ntwo\nthree\nfour\nfive\nsix\n');
    put(root, 'games/g/old.png', PNG);
    put(root, 'games/g/gone.test.ts', 'it("x")\n');
    put(root, 'package.json', '{"name":"x"}\n');
    put(root, 'keep/OFL-A.txt', 'license\n');
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', 'base');
    base = gitIn(root, 'rev-parse', 'HEAD');
    // The candidate's edits (some staged, some not, some untracked), as headless Claude would leave them.
    put(root, 'games/g/a.js', 'let a = 1;\nlet b = 3;\nfetch("https://evil.example.com");\n'); // modified, unstaged
    put(root, 'games/gearhold/levels.js', GEAR(2)); // a level removed
    put(root, 'games/tidepool-pals/levels.js', TIDE(5)); // a level added
    renameSync(join(root, 'games/g/old-name.js'), join(root, 'games/g/new-name.js')); // rename with a small edit
    put(root, 'games/g/new-name.js', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
    gitIn(root, 'add', '-A');
    unlinkSync(join(root, 'games/g/gone.test.ts')); // deleted, unstaged
    put(root, 'games/g/new.png', PNG); // untracked binary
    put(root, 'games/g/fresh.js', 'new file\n'); // untracked text
    put(root, 'package.json', '{"name":"x","dependencies":{"y":"1"}}\n'); // modified
    symlinkSync('/etc/passwd', join(root, 'games/g/link')); // untracked symlink to outside
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const counts = async () => ({ before: 7, after: 6 });
  const by = (d: Awaited<ReturnType<typeof collectDiff>>, p: string) => d.files.find((f) => f.path === p)!;

  it('reports statuses, contents, binary and symlink flags without following symlinks', async () => {
    const d = await collectDiff(root, base, { countTests: counts });
    expect(by(d, 'games/g/a.js')).toEqual({ path: 'games/g/a.js', status: 'M', before: 'let a = 1;\nlet b = 2;\n', after: 'let a = 1;\nlet b = 3;\nfetch("https://evil.example.com");\n', binary: false });
    expect(by(d, 'games/g/gone.test.ts')).toEqual({ path: 'games/g/gone.test.ts', status: 'D', before: 'it("x")\n', after: null, binary: false });
    expect(by(d, 'games/g/new-name.js')).toMatchObject({ status: 'R', oldPath: 'games/g/old-name.js', before: 'one\ntwo\nthree\nfour\nfive\nsix\n', after: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n' });
    expect(by(d, 'games/g/fresh.js')).toEqual({ path: 'games/g/fresh.js', status: 'A', before: null, after: 'new file\n', binary: false });
    expect(by(d, 'games/g/new.png')).toEqual({ path: 'games/g/new.png', status: 'A', before: null, after: null, binary: true });
    expect(by(d, 'games/g/link')).toEqual({ path: 'games/g/link', status: 'A', before: null, after: '/etc/passwd', binary: false, symlink: true });
    expect(by(d, 'package.json').status).toBe('M');
    expect(d.files.map((f) => f.path)).not.toContain('games/g/old.png'); // untouched files are absent
  });

  it('reports a modified binary as binary with no text', async () => {
    put(root, 'games/g/old.png', Buffer.concat([PNG, Buffer.from([9, 9])]));
    try {
      const d = await collectDiff(root, base, { countTests: counts });
      expect(by(d, 'games/g/old.png')).toEqual({ path: 'games/g/old.png', status: 'M', before: null, after: null, binary: true });
    } finally { gitIn(root, 'checkout', '--', 'games/g/old.png'); }
  });

  it('counts levels at the base and in the working tree, passes injected test counts, and lists the tree', async () => {
    const d = await collectDiff(root, base, { countTests: counts });
    expect(d.levelCounts).toEqual({ before: { 'tidepool-pals': 4, gearhold: 3 }, after: { 'tidepool-pals': 5, gearhold: 2 } });
    expect([d.testCountBefore, d.testCountAfter]).toEqual([7, 6]);
    expect(d.repoFiles).toContain('keep/OFL-A.txt');
    expect(d.repoFiles).toContain('games/g/fresh.js');
    expect(d.repoFiles).not.toContain('games/g/gone.test.ts');
    expect(d.repoFiles).not.toContain('games/g/old-name.js');
  });

  it('feeds checkTripwires end to end', async () => {
    const hits = checkTripwires(await collectDiff(root, base, { countTests: counts }));
    const rules = new Set(hits.map((h) => h.rule));
    for (const r of ['protected-path', 'dependency', 'network', 'level-removed', 'tests-removed', 'outside-scope', 'asset-source']) expect(rules, r).toContain(r);
  });

  it('an empty candidate has no files and equal level counts', async () => {
    const clean = mkdtempSync(join(tmpdir(), 'hal-git-clean-'));
    try {
      gitIn(clean, 'init', '-q', '-b', 'main');
      put(clean, 'games/gearhold/levels.js', GEAR(2));
      gitIn(clean, 'add', '-A'); gitIn(clean, 'commit', '-q', '-m', 'b');
      const d = await collectDiff(clean, 'HEAD', { countTests: async () => ({ before: 1, after: 1 }) });
      expect(d.files).toEqual([]);
      expect(d.levelCounts.before).toEqual(d.levelCounts.after);
      expect(checkTripwires(d)).toEqual([]);
    } finally { rmSync(clean, { recursive: true, force: true }); }
  });

  it('uses the injected git runner for every git call (the shared seam)', async () => {
    const calls: string[][] = [];
    const fake: GitRunner = vi.fn(async (args) => { calls.push(args); return ''; });
    const d = await collectDiff(root, 'BASE', { git: fake, countTests: counts });
    expect(d.files).toEqual([]);
    expect(calls.map((c) => c[0])).toEqual(expect.arrayContaining(['diff', 'ls-files']));
    expect(calls.find((c) => c[0] === 'diff')).toContain('BASE');
  });

  it('runGit rejects on a git failure', async () => {
    await expect(runGit(['rev-parse', '--verify', 'no-such-ref'], root)).rejects.toThrow();
  });
});
