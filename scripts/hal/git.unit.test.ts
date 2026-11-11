// collectDiff against a real temp git repo (no vitest-in-vitest: the test counter is injected).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkTripwires } from '@studio/core/hal';
import { collectDiff, countArrayItems, ensureMainWorktree, newCandidateWorktree, removeWorktree, revertPass, runGit, squashMerge, vitestCounts, type GitRunner } from './git.js';

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

describe('collectDiff fail-closed and binary-blinding defences', () => {
  const counts = async () => ({ before: 1, after: 1, beforeByFile: { 'a.test.ts': 2 }, afterByFile: { 'a.test.ts': 2 } });
  const mk = () => {
    const r = mkdtempSync(join(tmpdir(), 'hal-git2-'));
    gitIn(r, 'init', '-q', '-b', 'main');
    put(r, 'games/g/index.html', '<p>hi</p>\n');
    put(r, 'games/g/a.js', 'a\n');
    put(r, 'games/g/data.dat', 'plain\n');
    gitIn(r, 'add', '-A'); gitIn(r, 'commit', '-q', '-m', 'b');
    return r;
  };
  it('a .gitattributes -diff or a NUL byte cannot hide a text file: html/js are always decoded and scanned', async () => {
    const r = mk();
    try {
      put(r, '.gitattributes', '*.html -diff\n*.js -diff\n');
      put(r, 'games/g/index.html', '<p>hi</p>\n<script>fetch("https://evil.example.com")</script>\n');
      put(r, 'games/g/a.js', 'a\n\0\nfetch("https://evil.example.com")\n');
      put(r, 'games/g/data.dat', Buffer.from([0, 1, 2]));
      const d = await collectDiff(r, 'HEAD', { countTests: counts });
      const by = (p: string) => d.files.find((f) => f.path === p)!;
      expect(by('games/g/index.html')).toMatchObject({ binary: false, before: '<p>hi</p>\n' });
      expect(by('games/g/index.html').after).toContain('evil.example.com');
      expect(by('games/g/a.js')).toMatchObject({ binary: false });
      expect(by('games/g/a.js').after).toContain('fetch(');
      expect(by('games/g/data.dat').binary).toBe(true);
      const rules = checkTripwires(d).map((v) => v.rule);
      expect(rules).toEqual(expect.arrayContaining(['network', 'protected-path', 'asset-source']));
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
  it('throws (fail closed) when a changed path cannot be read', async () => {
    if (process.getuid?.() === 0) return; // root ignores file modes
    const r = mk();
    try {
      put(r, 'games/g/a.js', 'changed\n');
      chmodSync(join(r, 'games/g/a.js'), 0o000);
      await expect(collectDiff(r, 'HEAD', { countTests: counts })).rejects.toThrow();
    } finally { chmodSync(join(r, 'games/g/a.js'), 0o644); rmSync(r, { recursive: true, force: true }); }
  });
  it('throws when git show fails for a modified file, and when a path is neither file nor symlink', async () => {
    const r = mk();
    try {
      put(r, 'games/g/a.js', 'changed\n');
      const failing: GitRunner = async (args, cwd) => { if (args[0] === 'show') throw new Error('boom'); return runGit(args, cwd); };
      await expect(collectDiff(r, 'HEAD', { git: failing, countTests: counts })).rejects.toThrow('boom');
      const fake: GitRunner = async (args, cwd) => (args[0] === 'ls-files' && args.includes('--others') ? 'games/g/sub\0' : runGit(args, cwd));
      mkdirSync(join(r, 'games/g/sub'));
      await expect(collectDiff(r, 'HEAD', { git: fake, countTests: counts })).rejects.toThrow('not a regular file');
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
  it('passes per-file test counts through to the Diff', async () => {
    const r = mk();
    try {
      const d = await collectDiff(r, 'HEAD', { countTests: counts });
      expect(d.testCountsByFile).toEqual({ before: { 'a.test.ts': 2 }, after: { 'a.test.ts': 2 } });
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
  it('vitestCounts throws when git archive fails (bad base), instead of counting an empty tree', async () => {
    const r = mk();
    try { await expect(vitestCounts(r, 'no-such-ref')).rejects.toThrow(); } finally { rmSync(r, { recursive: true, force: true }); }
  });
  it('flags a text file with a NUL byte or UTF-16 BOM, still decoding it', async () => {
    const r = mk();
    try {
      put(r, 'games/g/a.js', Buffer.from([0xff, 0xfe, 0x61, 0x00]));
      put(r, 'games/g/index.html', 'ok\0\n');
      const d = await collectDiff(r, 'HEAD', { countTests: counts });
      expect(d.files.find((f) => f.path === 'games/g/a.js')).toMatchObject({ binary: false, suspectEncoding: true });
      expect(d.files.find((f) => f.path === 'games/g/index.html')).toMatchObject({ binary: false, suspectEncoding: true });
      expect(checkTripwires(d).filter((v) => v.rule === 'outside-scope')).toHaveLength(2);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
  it('level sources: absent at base is fine, any other git failure throws', async () => {
    const r = mk(); // no level files at base
    try {
      const d = await collectDiff(r, 'HEAD', { countTests: counts });
      expect(d.levelCounts.before).toEqual({});
      const broken: GitRunner = async (args, cwd) => { if (args[0] === 'ls-tree') throw new Error('corrupt'); return runGit(args, cwd); };
      await expect(collectDiff(r, 'HEAD', { git: broken, countTests: counts })).rejects.toThrow('corrupt');
      const showFails: GitRunner = async (args, cwd) => {
        if (args[0] === 'ls-tree') return 'games/gearhold/levels.js\n';
        if (args[0] === 'show') throw new Error('unreadable blob');
        return runGit(args, cwd);
      };
      await expect(collectDiff(r, 'HEAD', { git: showFails, countTests: counts })).rejects.toThrow('unreadable blob');
      await expect(collectDiff(r, 'no-such-ref', { countTests: counts })).rejects.toThrow();
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

// ---- worktrees and merges (Task 5) ----------------------------------------
// The temp repo's root plays Brian's checkout: it has `main` checked out, and must never be modified by Hal.

describe('Hal worktrees (temp git repo)', () => {
  const mkRepo = () => {
    const r = realpathSync(mkdtempSync(join(tmpdir(), 'hal-wt-')));
    gitIn(r, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(r, '.git/hooks')]]) gitIn(r, 'config', k!, v!);
    put(r, '.gitignore', 'node_modules/\n.data/\n');
    put(r, 'games/g/a.js', 'let a = 1;\n');
    put(r, 'packages/core/index.ts', 'export const core = 1;\n');
    gitIn(r, 'add', '-A');
    gitIn(r, 'commit', '-q', '-m', 'base');
    return r;
  };
  const head = (dir: string, ref = 'HEAD') => gitIn(dir, 'rev-parse', ref);
  const status = (dir: string) => gitIn(dir, 'status', '--porcelain', '--untracked-files=all');
  /** Makes a candidate with one edit, committed on its branch (as runCandidate does). */
  const candidate = async (r: string, pass: string, file = 'games/g/a.js', text = 'let a = 2;\n') => {
    const wt = await newCandidateWorktree(r, pass);
    put(wt.dir, file, text);
    gitIn(wt.dir, 'add', '-A');
    gitIn(wt.dir, 'commit', '-q', '-m', `wip ${pass}`);
    return wt;
  };
  let repos: string[] = [];
  const fresh = () => { const r = mkRepo(); repos.push(r); return r; };
  afterAll(() => { for (const r of repos) rmSync(r, { recursive: true, force: true }); repos = []; });

  describe('ensureMainWorktree', () => {
    it('creates .data/hal/wt/main detached at main, leaving the checkout that has main untouched', async () => {
      const r = fresh();
      put(r, 'games/g/a.js', 'brian is editing\n'); // Brian's uncommitted work
      const m = await ensureMainWorktree(r);
      expect(m.dir).toBe(join(r, '.data/hal/wt/main'));
      expect(head(m.dir)).toBe(head(r, 'refs/heads/main'));
      expect(m.head).toBe(head(r, 'refs/heads/main'));
      expect(gitIn(m.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD'); // detached
      expect(gitIn(r, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
      expect(readFileSync(join(r, 'games/g/a.js'), 'utf8')).toBe('brian is editing\n');
      expect(m.mainCheckedOutAt).toEqual([r]);
      expect(m.fetched).toBe(false); // no origin: non-fatal
    });
    it('resets leftovers of a crash mid-merge (staged, modified and untracked files) back to main', async () => {
      const r = fresh();
      const m = await ensureMainWorktree(r);
      put(m.dir, 'games/g/a.js', 'half merged\n');
      put(m.dir, 'games/g/new.js', 'x\n');
      gitIn(m.dir, 'add', '-A');
      put(m.dir, 'games/g/untracked.js', 'y\n');
      const again = await ensureMainWorktree(r);
      expect(again.dir).toBe(m.dir);
      expect(status(m.dir)).toBe('');
      expect(readFileSync(join(m.dir, 'games/g/a.js'), 'utf8')).toBe('let a = 1;\n');
    });
    it('fast-forwards main from origin/main when the fetch works, and never rewinds or forks it', async () => {
      const origin = realpathSync(mkdtempSync(join(tmpdir(), 'hal-origin-')));
      repos.push(origin);
      gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', origin);
      gitIn(r, 'push', '-q', 'origin', 'main');
      // Someone else pushes a commit to origin.
      const other = realpathSync(mkdtempSync(join(tmpdir(), 'hal-other-')));
      repos.push(other);
      gitIn(tmpdir(), 'clone', '-q', origin, other);
      for (const [k, v] of [['user.name', 'o'], ['user.email', 'o@o'], ['commit.gpgsign', 'false']]) gitIn(other, 'config', k!, v!);
      put(other, 'games/g/b.js', 'b\n');
      gitIn(other, 'add', '-A');
      gitIn(other, 'commit', '-q', '-m', 'remote change');
      gitIn(other, 'push', '-q', 'origin', 'main');
      const m = await ensureMainWorktree(r);
      expect(m.fetched).toBe(true);
      expect(m.fastForwarded).toBe(true);
      expect(head(r, 'refs/heads/main')).toBe(head(other));
      expect(head(m.dir)).toBe(head(other));
      // Local main ahead of origin: left alone.
      await candidate(r, 'HAL-1');
      expect((await squashMerge(r, 'HAL-1', 'fix(g): local')).ok).toBe(true);
      const ahead = head(r, 'refs/heads/main');
      const m2 = await ensureMainWorktree(r);
      expect(m2.fastForwarded).toBe(false);
      expect(head(r, 'refs/heads/main')).toBe(ahead);
    });
    it('treats an unreachable origin as non-fatal', async () => {
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', join(tmpdir(), 'hal-no-such-origin-xyz'));
      const before = head(r, 'refs/heads/main');
      const m = await ensureMainWorktree(r);
      expect(m.fetched).toBe(false);
      expect(head(m.dir)).toBe(before);
    });
  });

  describe('newCandidateWorktree / removeWorktree', () => {
    it('creates branch hal/<pass> from main at .data/hal/wt/<pass>, and removal deletes both', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const wt = await newCandidateWorktree(r, 'HAL-7');
      expect(wt).toEqual({ dir: join(r, '.data/hal/wt/HAL-7'), branch: 'hal/HAL-7', base: head(r, 'refs/heads/main') });
      expect(gitIn(wt.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('hal/HAL-7');
      expect(head(wt.dir)).toBe(wt.base);
      put(wt.dir, 'games/g/dirty.js', 'x\n'); // dirty and untracked: removal still works
      await removeWorktree(r, 'HAL-7');
      expect(existsSync(wt.dir)).toBe(false);
      expect(gitIn(r, 'branch', '--list', 'hal/HAL-7')).toBe('');
      expect(gitIn(r, 'worktree', 'list')).not.toContain('HAL-7');
    });
    it('clears a stale worktree and branch of the same pass left by a crash', async () => {
      const r = fresh();
      const wt = await newCandidateWorktree(r, 'HAL-8');
      put(wt.dir, 'games/g/a.js', 'stale\n');
      const again = await newCandidateWorktree(r, 'HAL-8');
      expect(status(again.dir)).toBe('');
      await removeWorktree(r, 'HAL-8');
    });
    it('removeWorktree never throws, even when there is nothing to remove', async () => {
      const r = fresh();
      await expect(removeWorktree(r, 'HAL-99')).resolves.toBeUndefined();
      const failing: GitRunner = async () => { throw new Error('git broke'); };
      const wt = await newCandidateWorktree(r, 'HAL-98');
      await expect(removeWorktree(r, 'HAL-98', { git: failing })).resolves.toBeUndefined();
      expect(existsSync(wt.dir)).toBe(false); // the directory goes even when git fails
      await removeWorktree(r, 'HAL-98');
      expect(gitIn(r, 'branch', '--list', 'hal/HAL-98')).toBe('');
    });
    it('rejects a pass id that is not a plain name', async () => {
      const r = fresh();
      for (const bad of ['../x', 'a/b', '', '-x', 'main', 'HAL 1']) await expect(newCandidateWorktree(r, bad)).rejects.toThrow(/pass id/);
    });
    it('links node_modules so workspace packages resolve to the worktree, and removal leaves the real ones alone', async () => {
      const r = fresh();
      put(r, 'node_modules/vitest/package.json', '{"name":"vitest"}\n');
      put(r, 'node_modules/.bin/vitest', '#!/bin/sh\n');
      mkdirSync(join(r, 'node_modules/@studio'), { recursive: true });
      symlinkSync('../../packages/core', join(r, 'node_modules/@studio/core'));
      const wt = await newCandidateWorktree(r, 'HAL-5');
      expect(realpathSync(join(wt.dir, 'node_modules/@studio/core'))).toBe(join(wt.dir, 'packages/core'));
      expect(realpathSync(join(wt.dir, 'node_modules/vitest'))).toBe(join(r, 'node_modules/vitest'));
      expect(existsSync(join(wt.dir, 'node_modules/.bin/vitest'))).toBe(true);
      expect(status(wt.dir)).toBe(''); // ignored, never part of a diff
      await removeWorktree(r, 'HAL-5');
      expect(readFileSync(join(r, 'node_modules/vitest/package.json'), 'utf8')).toContain('vitest');
      expect(realpathSync(join(r, 'node_modules/@studio/core'))).toBe(join(r, 'packages/core'));
    });
  });

  describe('squashMerge', () => {
    it('lands the candidate as exactly one new commit on main, with the given message and the candidate tree', async () => {
      const r = fresh();
      const m = await ensureMainWorktree(r);
      const old = head(r, 'refs/heads/main');
      const wt = await candidate(r, 'HAL-2');
      put(wt.dir, 'games/g/c.js', 'c\n');
      gitIn(wt.dir, 'add', '-A');
      gitIn(wt.dir, 'commit', '-q', '-m', 'second wip'); // two candidate commits squash to one
      const msg = 'polish(g): a title\n\nWhy it matters.\n\n# not a comment\n\nHal-Pass: HAL-2';
      const res = await squashMerge(r, 'HAL-2', msg);
      expect(res).toEqual({ ok: true, commit: head(r, 'refs/heads/main') });
      expect(head(r, 'refs/heads/main^')).toBe(old);
      expect(gitIn(r, 'log', '-1', '--format=%B', 'main')).toBe(msg);
      expect(head(r, 'main^{tree}')).toBe(head(r, 'hal/HAL-2^{tree}'));
      expect(head(m.dir)).toBe(head(r, 'refs/heads/main'));
      expect(status(m.dir)).toBe('');
      expect(readFileSync(join(r, 'games/g/a.js'), 'utf8')).toBe('let a = 1;\n'); // Brian's files: untouched
      await removeWorktree(r, 'HAL-2');
    });
    it('a failing commit (pre-commit hook) leaves main and its worktree at the old HEAD with a clean tree', async () => {
      const r = fresh();
      const m = await ensureMainWorktree(r);
      const old = head(r, 'refs/heads/main');
      await candidate(r, 'HAL-3', 'games/g/new.js', 'new\n');
      put(r, '.git/hooks/pre-commit', '#!/bin/sh\necho hook says no >&2\nexit 1\n');
      chmodSync(join(r, '.git/hooks/pre-commit'), 0o755);
      const res = await squashMerge(r, 'HAL-3', 'fix(g): x');
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toContain('hook says no');
      expect(head(r, 'refs/heads/main')).toBe(old);
      expect(head(m.dir)).toBe(old);
      expect(status(m.dir)).toBe('');
      expect(existsSync(join(m.dir, 'games/g/new.js'))).toBe(false);
      await removeWorktree(r, 'HAL-3');
    });
    it('a git runner failing on commit, or main moving underneath (compare-and-swap), leaves main alone', async () => {
      const r = fresh();
      const m = await ensureMainWorktree(r);
      const old = head(r, 'refs/heads/main');
      await candidate(r, 'HAL-4');
      const failCommit: GitRunner = async (args, cwd) => { if (args[0] === 'commit') throw new Error('commit exploded'); return runGit(args, cwd); };
      expect(await squashMerge(r, 'HAL-4', 'fix(g): x', { git: failCommit })).toEqual({ ok: false, error: expect.stringContaining('commit exploded') });
      expect(head(m.dir)).toBe(old);
      expect(status(m.dir)).toBe('');
      // Someone moves main between the commit and the ref update: the CAS refuses, and the worktree goes back.
      let moved = '';
      const race: GitRunner = async (args, cwd) => {
        if (args[0] === 'update-ref' && !moved) {
          gitIn(r, 'commit', '-q', '--allow-empty', '-m', 'brian commits meanwhile');
          moved = head(r, 'refs/heads/main');
        }
        return runGit(args, cwd);
      };
      expect((await squashMerge(r, 'HAL-4', 'fix(g): x', { git: race })).ok).toBe(false);
      expect(head(r, 'refs/heads/main')).toBe(moved);
      expect(head(m.dir)).toBe(old);
      expect(status(m.dir)).toBe('');
      await removeWorktree(r, 'HAL-4');
    });
    it('refuses (without touching main) when the main worktree is not at main, or the merged tree is not the candidate tree', async () => {
      const r = fresh();
      const m = await ensureMainWorktree(r);
      await candidate(r, 'HAL-6');
      gitIn(r, 'commit', '-q', '--allow-empty', '-m', 'main moved after the candidate branched');
      const moved = head(r, 'refs/heads/main');
      expect((await squashMerge(r, 'HAL-6', 'fix(g): x')).ok).toBe(false); // main worktree is behind main
      await ensureMainWorktree(r);
      put(r, 'games/g/a.js', 'let a = 1;\n'); // keep Brian's tree clean for this test
      gitIn(r, 'checkout', '-q', '--', '.');
      // Now main has a commit the candidate does not: a squash would merge a tree nobody checked.
      put(r, 'other.txt', 'o\n');
      gitIn(r, 'add', '-A');
      gitIn(r, 'commit', '-q', '-m', 'another main change');
      await ensureMainWorktree(r);
      const res = await squashMerge(r, 'HAL-6', 'fix(g): x');
      expect(res).toEqual({ ok: false, error: expect.stringContaining('tree') });
      expect(head(r, 'refs/heads/main')).not.toBe(moved);
      expect(head(m.dir)).toBe(head(r, 'refs/heads/main'));
      expect(status(m.dir)).toBe('');
      await removeWorktree(r, 'HAL-6');
    });
  });

  describe('revertPass', () => {
    it('finds the merge commit of a pass by its Hal-Pass trailer, ignoring undo commits; null when absent', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const trailers = (pass: string, extra = '') => `Hal-Pass: ${pass}\nHal-Game: g\nHal-Kind: fix\nHal-Why: w\nHal-Score-Before: 1\nHal-Score-After: 2\nHal-Version: 0.1.1\nHal-Run: r1${extra}`;
      await candidate(r, 'HAL-10');
      const res = await squashMerge(r, 'HAL-10', `fix(g): ten\n\nwhy\n\n${trailers('HAL-10')}`);
      expect(res.ok).toBe(true);
      await removeWorktree(r, 'HAL-10');
      await ensureMainWorktree(r);
      await candidate(r, 'HAL-11', 'games/g/a.js', 'let a = 1;\n');
      expect((await squashMerge(r, 'HAL-11', `fix(g): undo ten\n\n${trailers('HAL-10', '\nHal-Undo: HAL-10\nHal-Reason: no')}`)).ok).toBe(true);
      await removeWorktree(r, 'HAL-11');
      expect(await revertPass(r, 'HAL-10')).toBe(res.ok && res.commit);
      expect(await revertPass(r, 'HAL-404')).toBeNull();
      expect(await revertPass(r, 'HAL-1')).toBeNull(); // no prefix matches
    });
  });
});
