// collectDiff against a real temp git repo (no vitest-in-vitest: the test counter is injected).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkTripwires } from '@studio/core/hal';
import {
  blobText, changedPaths, collectDiff, collectTreeDiff, commitTree, countArrayItems, ensureMainWorktree, extendTree, HAL_MAIN, mainWorktreeDir, newCandidateWorktree,
  addFileToTree, adoptHeld, dropHeld, holdCandidate, linkNodeModules, listHeld, pushHalMain, replayHalOnto, trustRootDigest, removeWorktree, revertPass, runGit, snapshotTree, squashMerge, verifyNodeModules, vitestCounts, type GitRunner,
} from './git.js';

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

/** The git subcommand of an argv that may start with `-c k=v` pairs (safeGit adds them). */
const sub = (args: string[]) => { let i = 0; while (args[i] === '-c') i += 2; return args[i]; };

describe('Hal worktrees (temp git repo)', () => {
  const cfg = (r: string, name = 't') => { for (const [k, v] of [['user.name', name], ['user.email', `${name}@t`], ['commit.gpgsign', 'false'], ['core.hooksPath', join(r, '.git/hooks')]]) gitIn(r, 'config', k!, v!); };
  const mkRepo = () => {
    const r = realpathSync(mkdtempSync(join(tmpdir(), 'hal-wt-')));
    gitIn(r, 'init', '-q', '-b', 'main');
    cfg(r);
    put(r, '.gitignore', 'node_modules/\n.data/\n*.log\n');
    put(r, 'games/g/a.js', 'let a = 1;\n');
    put(r, 'games/g/b.js', 'let b = 1;\n');
    put(r, 'packages/core/index.ts', 'export const core = 1;\n');
    gitIn(r, 'add', '-A');
    gitIn(r, 'commit', '-q', '-m', 'base');
    return r;
  };
  const head = (dir: string, ref = 'HEAD') => gitIn(dir, 'rev-parse', ref);
  const status = (dir: string) => gitIn(dir, 'status', '--porcelain', '--untracked-files=all');
  /** A verified candidate with one edit (as runCandidate makes it: tree from disk, commit-tree on the base). */
  const candidate = async (r: string, pass: string, file = 'games/g/a.js', text = 'let a = 2;\n') => {
    const wt = await newCandidateWorktree(r, pass);
    put(wt.dir, file, text);
    const tree = await snapshotTree(wt.dir, wt.base, { prune: true });
    const commit = await commitTree(r, tree, wt.base, `wip ${pass}`);
    return { wt, verified: { commit, tree } };
  };
  /** Everything about Brian's checkout that Hal must never change. */
  const brianState = (r: string) => ({
    head: gitIn(r, 'symbolic-ref', 'HEAD'), sha: head(r), main: head(r, 'refs/heads/main'),
    index: readFileSync(join(r, '.git/index')).toString('base64'),
    a: readFileSync(join(r, 'games/g/a.js'), 'utf8'), b: readFileSync(join(r, 'games/g/b.js'), 'utf8'), status: status(r),
  });
  const bare = () => { const o = realpathSync(mkdtempSync(join(tmpdir(), 'hal-origin-'))); repos.push(o); gitIn(o, 'init', '-q', '--bare', '-b', 'main'); return o; };
  const clone = (origin: string) => { const c = realpathSync(mkdtempSync(join(tmpdir(), 'hal-other-'))); repos.push(c); gitIn(tmpdir(), 'clone', '-q', origin, c); cfg(c, 'o'); return c; };
  const pushFrom = (c: string, file: string) => { put(c, file, `${file}\n`); gitIn(c, 'add', '-A'); gitIn(c, 'commit', '-q', '-m', file); gitIn(c, 'push', '-q', 'origin', 'HEAD:main'); return head(c); };
  let repos: string[] = [];
  const fresh = () => { const r = mkRepo(); repos.push(r); return r; };
  afterAll(() => { for (const r of repos) rmSync(r, { recursive: true, force: true }); repos = []; });

  describe('ensureMainWorktree', () => {
    it('creates refs/hal/main from local main and a worktree detached at it, touching nothing of Brian\'s', async () => {
      const r = fresh();
      put(r, 'games/g/a.js', 'brian is editing\n'); // Brian's uncommitted work
      put(r, 'games/g/b.js', 'brian staged this\n');
      gitIn(r, 'add', 'games/g/b.js');
      const before = brianState(r);
      const m = await ensureMainWorktree(r);
      expect(m).toEqual({ dir: join(r, '.data/hal/wt/main'), head: head(r, 'refs/heads/main'), fetched: false, fastForwarded: false, diverged: false });
      expect(head(r, HAL_MAIN)).toBe(head(r, 'refs/heads/main'));
      expect(head(m.dir)).toBe(head(r, HAL_MAIN));
      expect(gitIn(m.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD'); // detached
      expect(brianState(r)).toEqual(before);
    });
    it('resets leftovers of a crash mid-merge (staged, modified and untracked files)', async () => {
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
    it('with origin: creates from origin/main, fast-forwards, leaves Hal-ahead alone, and reports divergence without moving', async () => {
      const origin = bare();
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', origin);
      gitIn(r, 'push', '-q', 'origin', 'main');
      const other = clone(origin);
      const o1 = pushFrom(other, 'games/g/o1.js'); // origin is ahead of Brian's local main
      const brianMain = head(r, 'refs/heads/main');
      const m = await ensureMainWorktree(r);
      expect(m).toMatchObject({ fetched: true, fastForwarded: false, diverged: false, head: o1 });
      expect(head(r, HAL_MAIN)).toBe(o1);
      const o2 = pushFrom(other, 'games/g/o2.js');
      expect(await ensureMainWorktree(r)).toMatchObject({ fastForwarded: true, diverged: false, head: o2 });
      // Hal ahead of origin: left alone.
      const c = await candidate(r, 'HAL-1');
      expect((await squashMerge(r, 'HAL-1', 'fix(g): local', c.verified)).ok).toBe(true);
      const ahead = head(r, HAL_MAIN);
      expect(await ensureMainWorktree(r)).toMatchObject({ fastForwarded: false, diverged: false, head: ahead });
      // Origin moves too: diverged, nothing moves.
      gitIn(other, 'pull', '-q', '--rebase=false', 'origin', 'main');
      pushFrom(other, 'games/g/o3.js');
      expect(await ensureMainWorktree(r)).toMatchObject({ fetched: true, fastForwarded: false, diverged: true, head: ahead });
      expect(head(r, HAL_MAIN)).toBe(ahead);
      expect(head(r, 'refs/heads/main')).toBe(brianMain); // never written
    });
    it('treats an unreachable origin as non-fatal and starts from local main', async () => {
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', join(tmpdir(), 'hal-no-such-origin-xyz'));
      const m = await ensureMainWorktree(r);
      expect(m.fetched).toBe(false);
      expect(head(m.dir)).toBe(head(r, 'refs/heads/main'));
    });
  });

  describe('held features', () => {
    it('hold keeps a verified commit off refs/hal/main; ship replays it on top of whatever merged since; drop deletes it', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const base = head(r, HAL_MAIN);
      const f = await candidate(r, 'HAL-7', 'games/g/feature.js', 'new\n');
      const held = await holdCandidate(r, 'HAL-7', 'feature(g): a new mode', f.verified);
      if (!held.ok) throw new Error(held.error);
      expect(head(r, HAL_MAIN)).toBe(base); // nothing on main
      expect(await listHeld(r)).toEqual([{ pass: 'HAL-7', commit: held.commit, subject: 'feature(g): a new mode' }]);
      expect((await holdCandidate(r, 'HAL-7', 'again', f.verified)).ok).toBe(false); // create-only
      // a tuning change merges meanwhile, then Brian ships the feature
      const t = await candidate(r, 'HAL-8', 'games/g/a.js', 'let a = 3;\n');
      expect((await squashMerge(r, 'HAL-8', 'tuning(g): x', t.verified)).ok).toBe(true);
      const mid = head(r, HAL_MAIN);
      const s2 = await adoptHeld(r, 'HAL-7');
      if (!s2.ok) throw new Error(s2.error);
      expect(gitIn(r, 'rev-parse', `${s2.commit}^`)).toBe(mid);
      expect(gitIn(r, 'show', `${HAL_MAIN}:games/g/feature.js`)).toBe('new');
      expect(gitIn(r, 'show', `${HAL_MAIN}:games/g/a.js`)).toBe('let a = 3;');
      expect(gitIn(r, 'log', '-1', '--format=%s', HAL_MAIN)).toBe('feature(g): a new mode');
      expect(await listHeld(r)).toEqual([]);
      expect((await adoptHeld(r, 'HAL-7')).ok).toBe(false); // gone
      const g = await candidate(r, 'HAL-9', 'games/g/b.js', 'x\n');
      expect((await holdCandidate(r, 'HAL-9', 'feature(g): b', g.verified)).ok).toBe(true);
      expect(await dropHeld(r, 'HAL-9')).toBe(true);
      expect(await dropHeld(r, 'HAL-9')).toBe(false);
      expect(await listHeld(r)).toEqual([]);
    });
    it('a held feature whose lines main changed since does not ship: conflict, nothing moves', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const f = await candidate(r, 'HAL-1', 'games/g/a.js', 'let a = 100;\n');
      const held = await holdCandidate(r, 'HAL-1', 'feature(g): a', f.verified);
      expect(held.ok).toBe(true);
      const t = await candidate(r, 'HAL-2', 'games/g/a.js', 'let a = 5;\n');
      expect((await squashMerge(r, 'HAL-2', 'tuning(g): a', t.verified)).ok).toBe(true);
      const before = head(r, HAL_MAIN);
      const s2 = await adoptHeld(r, 'HAL-1');
      expect(s2).toMatchObject({ ok: false, conflict: true });
      expect(head(r, HAL_MAIN)).toBe(before);
      expect((await listHeld(r)).map((h) => h.pass)).toEqual(['HAL-1']);
    });
  });

  describe('replayHalOnto', () => {
    const trailers = (pass: string) => `Hal-Pass: ${pass}\nHal-Game: g\nHal-Kind: fix\nHal-Why: w\nHal-Score-Before: 1\nHal-Score-After: 2\nHal-Version: 0.1.1\nHal-Run: r1`;
    /** Hal merges HAL-1 (touching `halFile`) without pushing; then origin gets a commit touching `otherFile`. */
    const divergedRepo = async (halFile: string, otherFile: string) => {
      const origin = bare();
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', origin);
      gitIn(r, 'push', '-q', 'origin', 'main');
      await ensureMainWorktree(r);
      const c = await candidate(r, 'HAL-1', halFile, 'hal\n');
      expect((await squashMerge(r, 'HAL-1', `fix(g): hal change\n\n${trailers('HAL-1')}`, c.verified)).ok).toBe(true);
      const other = clone(origin);
      put(other, otherFile, 'origin\n'); gitIn(other, 'add', '-A'); gitIn(other, 'commit', '-q', '-m', 'origin change'); gitIn(other, 'push', '-q', 'origin', 'HEAD:main');
      expect(await ensureMainWorktree(r)).toMatchObject({ diverged: true });
      return r;
    };
    it('rebuilds Hal\'s commits on origin/main with the same message, author and change, without moving any ref', async () => {
      const r = await divergedRepo('games/g/hal.js', 'games/g/origin.js');
      const from = head(r, HAL_MAIN);
      const rp = await replayHalOnto(r);
      if (!rp.ok) throw new Error(rp.reason);
      expect(rp).toMatchObject({ from, onto: head(r, 'refs/remotes/origin/main'), replayed: 1, dropped: 0 });
      expect(head(r, HAL_MAIN)).toBe(from); // the caller moves it, after ci:local
      expect(gitIn(r, 'rev-parse', `${rp.head}^`)).toBe(rp.onto);
      expect(gitIn(r, 'log', '-1', '--format=%B', rp.head)).toBe(gitIn(r, 'log', '-1', '--format=%B', from));
      expect(gitIn(r, 'log', '-1', '--format=%an %ae %aI', rp.head)).toBe(gitIn(r, 'log', '-1', '--format=%an %ae %aI', from));
      expect(gitIn(r, 'show', `${rp.head}:games/g/hal.js`)).toBe('hal');
      expect(gitIn(r, 'show', `${rp.head}:games/g/origin.js`)).toBe('origin');
      // Undo still finds the pass by its trailer once Hal's ref points at the replay.
      gitIn(r, 'update-ref', HAL_MAIN, rp.head, from);
      expect(await revertPass(r, 'HAL-1')).toBe(rp.head);
    });
    it('refuses on a conflict and leaves refs/hal/main alone', async () => {
      const r = await divergedRepo('games/g/same.js', 'games/g/same.js');
      const from = head(r, HAL_MAIN);
      const rp = await replayHalOnto(r);
      expect(rp.ok).toBe(false);
      if (!rp.ok) expect(rp.reason).toMatch(/fix\(g\): hal change.*conflicts with origin\/main/);
      expect(head(r, HAL_MAIN)).toBe(from);
    });
    it('drops a commit whose change origin already has', async () => {
      const origin = bare();
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', origin);
      gitIn(r, 'push', '-q', 'origin', 'main');
      await ensureMainWorktree(r);
      const base = head(r, HAL_MAIN);
      const { verified } = await candidate(r, 'HAL-1', 'games/g/x.js', 'x\n');
      gitIn(r, 'update-ref', HAL_MAIN, await commitTree(r, verified.tree, base, 'hal x'));
      gitIn(r, 'push', '-q', 'origin', `${await commitTree(r, verified.tree, base, 'brian x')}:refs/heads/main`); // same change, other commit
      await ensureMainWorktree(r);
      const rp = await replayHalOnto(r);
      expect(rp).toMatchObject({ ok: true, replayed: 0, dropped: 1 });
      if (rp.ok) expect(rp.head).toBe(rp.onto);
    });
  });

  describe('newCandidateWorktree / removeWorktree', () => {
    it('creates branch hal/<pass> from refs/hal/main at .data/hal/wt/<pass> without running hooks; removal deletes both', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      put(r, '.git/hooks/post-checkout', `#!/bin/sh\ntouch ${join(r, 'hook-ran')}\n`);
      chmodSync(join(r, '.git/hooks/post-checkout'), 0o755);
      const wt = await newCandidateWorktree(r, 'HAL-7');
      expect(existsSync(join(r, 'hook-ran'))).toBe(false);
      expect(wt).toEqual({ dir: join(r, '.data/hal/wt/HAL-7'), branch: 'hal/HAL-7', base: head(r, HAL_MAIN) });
      expect(gitIn(wt.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('hal/HAL-7');
      put(wt.dir, 'games/g/dirty.js', 'x\n');
      await removeWorktree(r, 'HAL-7');
      expect(existsSync(wt.dir)).toBe(false);
      expect(gitIn(r, 'branch', '--list', 'hal/HAL-7')).toBe('');
      expect(gitIn(r, 'worktree', 'list')).not.toContain('HAL-7');
    });
    it('clears a stale worktree and branch of the same pass left by a crash', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const wt = await newCandidateWorktree(r, 'HAL-8');
      put(wt.dir, 'games/g/a.js', 'stale\n');
      const again = await newCandidateWorktree(r, 'HAL-8');
      expect(status(again.dir)).toBe('');
      await removeWorktree(r, 'HAL-8');
    });
    it('removeWorktree never throws, even when there is nothing to remove or git fails', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      await expect(removeWorktree(r, 'HAL-99')).resolves.toBeUndefined();
      const failing: GitRunner = async () => { throw new Error('git broke'); };
      const wt = await newCandidateWorktree(r, 'HAL-98');
      await expect(removeWorktree(r, 'HAL-98', { git: failing })).resolves.toBeUndefined();
      expect(existsSync(wt.dir)).toBe(false);
      await removeWorktree(r, 'HAL-98');
      expect(gitIn(r, 'branch', '--list', 'hal/HAL-98')).toBe('');
    });
    it('rejects a pass id that is not a plain name', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      for (const bad of ['../x', 'a/b', '', '-x', 'main', 'HAL 1']) await expect(newCandidateWorktree(r, bad)).rejects.toThrow(/pass id/);
    });
    it('links node_modules so workspace packages resolve to the worktree, and removal leaves the real ones alone', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      put(r, 'node_modules/vitest/package.json', '{"name":"vitest"}\n');
      put(r, 'node_modules/.bin/vitest', '#!/bin/sh\n');
      mkdirSync(join(r, 'node_modules/@studio'), { recursive: true });
      symlinkSync('../../packages/core', join(r, 'node_modules/@studio/core'));
      const wt = await newCandidateWorktree(r, 'HAL-5');
      expect(realpathSync(join(wt.dir, 'node_modules/@studio/core'))).toBe(join(wt.dir, 'packages/core'));
      expect(realpathSync(join(wt.dir, 'node_modules/vitest'))).toBe(join(r, 'node_modules/vitest'));
      expect(existsSync(join(wt.dir, 'node_modules/.bin/vitest'))).toBe(true);
      expect(status(wt.dir)).toBe('');
      await removeWorktree(r, 'HAL-5');
      expect(readFileSync(join(r, 'node_modules/vitest/package.json'), 'utf8')).toContain('vitest');
      expect(realpathSync(join(r, 'node_modules/@studio/core'))).toBe(join(r, 'packages/core'));
    });
  });

  describe('node_modules of a worktree', () => {
    it('verifyNodeModules accepts exactly what linkNodeModules makes, and rejects swapped, extra or replaced entries', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      put(r, 'node_modules/vitest/vitest.mjs', 'real\n');
      put(r, 'node_modules/.bin/vitest', '#!/bin/sh\n');
      mkdirSync(join(r, 'node_modules/@studio'), { recursive: true });
      symlinkSync('../../packages/core', join(r, 'node_modules/@studio/core'));
      const wt = await newCandidateWorktree(r, 'HAL-40');
      const nm = join(wt.dir, 'node_modules');
      await expect(verifyNodeModules(wt.dir, r)).resolves.toBeUndefined();
      const tamper: Array<[string, () => void]> = [
        ['stub .bin', () => { unlinkSync(join(nm, '.bin')); put(nm, '.bin/vitest', '#!/bin/sh\nexit 0\n'); }],
        ['relinked package', () => { unlinkSync(join(nm, 'vitest')); symlinkSync('/tmp', join(nm, 'vitest')); }],
        ['extra entry', () => { put(nm, 'evil/index.js', 'x\n'); }],
        ['@studio pointed back at the checkout', () => { unlinkSync(join(nm, '@studio/core')); symlinkSync(join(r, 'packages/core'), join(nm, '@studio/core')); }],
        ['node_modules itself a symlink', () => { rmSync(nm, { recursive: true }); symlinkSync(join(r, 'node_modules'), nm); }],
      ];
      for (const [name, f] of tamper) {
        f();
        await expect(verifyNodeModules(wt.dir, r), name).rejects.toThrow(/node_modules/);
        await linkNodeModules(wt.dir, r);
        await expect(verifyNodeModules(wt.dir, r), `${name} relinked`).resolves.toBeUndefined();
      }
      expect(readFileSync(join(r, 'node_modules/vitest/vitest.mjs'), 'utf8')).toBe('real\n'); // the real ones untouched
      await removeWorktree(r, 'HAL-40');
    });
  });

  describe('trust root and private files', () => {
    it('trustRootDigest changes when a package.json, a .bin link or a tool entry changes, and only then', async () => {
      const r = fresh();
      put(r, 'node_modules/a/package.json', '{"name":"a"}\n');
      put(r, 'node_modules/a/index.js', 'x\n');
      put(r, 'node_modules/@s/b/package.json', '{"name":"@s/b"}\n');
      put(r, 'node_modules/vitest/vitest.mjs', 'v\n');
      mkdirSync(join(r, 'node_modules/.bin'), { recursive: true });
      symlinkSync('../vitest/vitest.mjs', join(r, 'node_modules/.bin/vitest'));
      const d0 = await trustRootDigest(r);
      expect(await trustRootDigest(r)).toBe(d0);
      const changes: Array<() => void> = [
        () => put(r, 'node_modules/a/package.json', '{"name":"a","main":"evil.js"}\n'),
        () => put(r, 'node_modules/@s/b/package.json', '{"name":"evil"}\n'),
        () => put(r, 'node_modules/vitest/vitest.mjs', 'stub\n'),
        () => { unlinkSync(join(r, 'node_modules/.bin/vitest')); symlinkSync('/bin/true', join(r, 'node_modules/.bin/vitest')); },
        () => put(r, 'node_modules/new/package.json', '{}\n'),
      ];
      let prev = d0;
      for (const [i, ch] of changes.entries()) { ch(); const d = await trustRootDigest(r); expect(d, `change ${i}`).not.toBe(prev); prev = d; }
    });
    it('addFileToTree hashes a private file straight into the tree and refuses a symlink', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const wt = await newCandidateWorktree(r, 'HAL-42');
      const priv = join(r, '.data/hal/tmp/HAL-42');
      put(priv, 'shot.jpg', 'JPEGBYTES');
      const base = head(r, 'HEAD^{tree}');
      const t = await addFileToTree(wt.dir, base, 'docs/x/shot.jpg', join(priv, 'shot.jpg'), { tmpRoot: priv });
      expect(await changedPaths(wt.dir, base, t)).toEqual(['docs/x/shot.jpg']);
      expect(await blobText(wt.dir, t, 'docs/x/shot.jpg')).toBe('JPEGBYTES');
      expect(existsSync(join(wt.dir, 'docs/x/shot.jpg'))).toBe(false); // never written to the worktree
      symlinkSync(join(priv, 'shot.jpg'), join(priv, 'link.jpg'));
      await expect(addFileToTree(wt.dir, base, 'docs/x/l.jpg', join(priv, 'link.jpg'))).rejects.toThrow(/not a regular file/);
      await removeWorktree(r, 'HAL-42');
    });
  });

  describe('vitestCounts', () => {
    it('exports the base (safe git archive) under tmpRoot with its own node_modules, and cleans up', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      mkdirSync(join(r, 'node_modules/@studio'), { recursive: true });
      symlinkSync('../../packages/core', join(r, 'node_modules/@studio/core'));
      const wt = await newCandidateWorktree(r, 'HAL-41');
      const root = join(r, '.data/hal/tmp/HAL-41');
      const dirs: string[] = [];
      const list = async (dir: string) => {
        dirs.push(dir);
        if (dir !== wt.dir) expect(realpathSync(join(dir, 'node_modules/@studio/core'))).toBe(join(dir, 'packages/core'));
        return `[{"file":"${realpathSync(dir)}/a.test.ts"}]`;
      };
      put(r, '.git/hooks/post-checkout', `#!/bin/sh\ntouch ${join(r, 'hook-ran')}\n`);
      chmodSync(join(r, '.git/hooks/post-checkout'), 0o755);
      expect(await vitestCounts(wt.dir, wt.base, list, { tmpRoot: root, repo: r })).toEqual({ before: 1, after: 1, beforeByFile: { 'a.test.ts': 1 }, afterByFile: { 'a.test.ts': 1 } });
      expect(dirs[0]!.startsWith(join(root, 'hal-base-'))).toBe(true);
      expect(existsSync(dirs[0]!)).toBe(false);
      expect(existsSync(join(r, 'hook-ran'))).toBe(false);
      await removeWorktree(r, 'HAL-41');
    });
  });

  describe('candidate trees (private index, no filters)', () => {
    const setup = async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      return { r, wt: await newCandidateWorktree(r, 'HAL-20') };
    };
    const blob = (r: string, tree: string, p: string) => gitIn(r, 'cat-file', 'blob', `${tree}:${p}`);
    const evil = 'fetch("https://evil.example.com/x");\n';

    it('hashes the disk: edits, deletes, untracked, symlinks and modes; prune drops ignored files but keeps node_modules', async () => {
      const { r, wt } = await setup();
      put(wt.dir, 'games/g/a.js', 'let a = 9;\n');
      unlinkSync(join(wt.dir, 'games/g/b.js'));
      put(wt.dir, 'games/g/new.js', 'n\n');
      put(wt.dir, 'games/g/run.sh', '#!/bin/sh\n');
      chmodSync(join(wt.dir, 'games/g/run.sh'), 0o755);
      symlinkSync('a.js', join(wt.dir, 'games/g/link'));
      put(wt.dir, 'games/g/debug.log', 'ignored\n');
      put(wt.dir, '.data/hal/x.json', '{}\n');
      mkdirSync(join(wt.dir, 'node_modules'), { recursive: true });
      put(wt.dir, 'node_modules/keep.txt', 'k\n');
      const tree = await snapshotTree(wt.dir, wt.base, { prune: true });
      expect(blob(r, tree, 'games/g/a.js')).toBe('let a = 9;');
      expect(gitIn(r, 'ls-tree', '-r', tree).split('\n').map((l) => l.replace(/ [0-9a-f]{40}/, '')).sort()).toEqual([
        '100644 blob\t.gitignore', '100644 blob\tgames/g/a.js', '100644 blob\tgames/g/new.js', '100644 blob\tpackages/core/index.ts', '100755 blob\tgames/g/run.sh', '120000 blob\tgames/g/link',
      ].sort());
      expect(existsSync(join(wt.dir, 'games/g/debug.log'))).toBe(false); // pruned: the checks see exactly the tree
      expect(existsSync(join(wt.dir, '.data/hal/x.json'))).toBe(false);
      expect(existsSync(join(wt.dir, 'node_modules/keep.txt'))).toBe(true);
      expect(await changedPaths(wt.dir, wt.base, tree)).toEqual(['games/g/a.js', 'games/g/b.js', 'games/g/link', 'games/g/new.js', 'games/g/run.sh']);
      put(wt.dir, 'games/g/a.js', 'let a = 10;\n');
      const ext = await extendTree(wt.dir, tree, ['games/g/a.js']);
      expect(await changedPaths(wt.dir, tree, ext)).toEqual(['games/g/a.js']);
      expect(await blobText(wt.dir, ext, 'games/g/a.js')).toBe('let a = 10;\n');
      await expect(snapshotTree(r, head(r), { prune: true })).rejects.toThrow(/refusing to prune/); // never Brian's checkout
    });
    it('sees through assume-unchanged and skip-worktree: the tripwires get the real bytes', async () => {
      for (const flag of ['--assume-unchanged', '--skip-worktree']) {
        const { r, wt } = await setup();
        put(wt.dir, 'games/g/a.js', evil);
        gitIn(wt.dir, 'update-index', flag, 'games/g/a.js');
        expect(status(wt.dir)).toBe(''); // git status is fooled
        const tree = await snapshotTree(wt.dir, wt.base, { prune: true });
        expect(blob(r, tree, 'games/g/a.js')).toBe(evil.trim());
        const d = await collectTreeDiff(wt.dir, wt.base, tree, { countTests: async () => ({ before: 1, after: 1 }) });
        expect(checkTripwires(d).map((v) => v.rule), flag).toContain('network');
        await removeWorktree(r, 'HAL-20');
      }
    });
    it('ignores clean filters (.git/config + info/attributes): the tree holds the bytes on disk', async () => {
      const { r, wt } = await setup();
      gitIn(r, 'config', 'filter.hide.clean', 'sed s/evil.example.com/ok.example.com/');
      put(r, '.git/info/attributes', '*.js filter=hide\n');
      put(wt.dir, 'games/g/a.js', evil);
      expect(gitIn(wt.dir, 'hash-object', 'games/g/a.js')).not.toBe(gitIn(wt.dir, 'hash-object', '--no-filters', 'games/g/a.js')); // the filter is live
      const tree = await snapshotTree(wt.dir, wt.base, { prune: true });
      expect(blob(r, tree, 'games/g/a.js')).toContain('evil.example.com');
      const d = await collectTreeDiff(wt.dir, wt.base, tree, { countTests: async () => ({ before: 1, after: 1 }) });
      expect(checkTripwires(d).map((v) => v.rule)).toContain('network');
    });
    it('collectTreeDiff matches collectDiff on a plain worktree', async () => {
      const { wt } = await setup();
      put(wt.dir, 'games/g/a.js', 'let a = 1;\nlet z = 2;\n');
      unlinkSync(join(wt.dir, 'games/g/b.js'));
      put(wt.dir, 'games/g/pic.png', PNG);
      symlinkSync('/etc/passwd', join(wt.dir, 'games/g/link'));
      const counts = async () => ({ before: 2, after: 2 });
      const disk = await collectDiff(wt.dir, wt.base, { countTests: counts });
      const tree = await collectTreeDiff(wt.dir, wt.base, await snapshotTree(wt.dir, wt.base), { countTests: counts });
      const norm = (d: typeof disk) => ({ ...d, files: [...d.files].sort((x, y) => x.path.localeCompare(y.path)), repoFiles: [...(d.repoFiles ?? [])].sort() });
      expect(norm(tree)).toEqual(norm(disk));
    });
    it('collectTreeDiff reports an (unstaged) rename with both paths, which the disk diff sees only as add + delete', async () => {
      const { wt } = await setup();
      renameSync(join(wt.dir, 'games/g/b.js'), join(wt.dir, 'games/g/c.js'));
      const d = await collectTreeDiff(wt.dir, wt.base, await snapshotTree(wt.dir, wt.base), { countTests: async () => ({ before: 1, after: 1 }) });
      expect(d.files).toEqual([{ path: 'games/g/c.js', oldPath: 'games/g/b.js', status: 'R', before: 'let b = 1;\n', after: 'let b = 1;\n', binary: false }]);
    });
  });

  describe('squashMerge', () => {
    it('lands exactly the verified tree as one commit on refs/hal/main; Brian\'s checkout on main stays byte-identical', async () => {
      const r = fresh();
      put(r, 'games/g/a.js', 'brian is editing\n');
      put(r, 'games/g/b.js', 'brian staged this\n');
      gitIn(r, 'add', 'games/g/b.js');
      const m = await ensureMainWorktree(r);
      const brian = brianState(r);
      const old = head(r, HAL_MAIN);
      const c = await candidate(r, 'HAL-2');
      const msg = 'polish(g): a title\n\nWhy it matters.\n\n# not a comment\n\nHal-Pass: HAL-2';
      const res = await squashMerge(r, 'HAL-2', msg, c.verified);
      expect(res).toEqual({ ok: true, commit: head(r, HAL_MAIN) });
      expect(head(r, `${HAL_MAIN}^`)).toBe(old);
      expect(gitIn(r, 'log', '-1', '--format=%B', HAL_MAIN)).toBe(msg);
      expect(head(r, `${HAL_MAIN}^{tree}`)).toBe(c.verified.tree);
      expect(head(m.dir)).toBe(head(r, HAL_MAIN));
      expect(status(m.dir)).toBe('');
      expect(brianState(r)).toEqual(brian); // HEAD, refs/heads/main, index bytes, files: all unchanged
      await removeWorktree(r, 'HAL-2');
    });
    it('commits the verified tree even if the branch ref moves after verification', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const c = await candidate(r, 'HAL-12');
      gitIn(r, 'update-ref', 'refs/heads/hal/HAL-12', (await candidate(r, 'HAL-13', 'games/g/a.js', 'let a = 666;\n')).verified.commit);
      expect((await squashMerge(r, 'HAL-12', 'fix(g): x', c.verified)).ok).toBe(true);
      expect(gitIn(r, 'show', `${HAL_MAIN}:games/g/a.js`)).toBe('let a = 2;');
      await removeWorktree(r, 'HAL-12');
      await removeWorktree(r, 'HAL-13');
    });
    it('a failing commit, or refs/hal/main moving underneath (compare-and-swap), leaves it and its worktree alone', async () => {
      const r = fresh();
      const m = await ensureMainWorktree(r);
      const old = head(r, HAL_MAIN);
      const c = await candidate(r, 'HAL-4');
      const failCommit: GitRunner = async (args, cwd, o) => { if (sub(args) === 'commit-tree') throw new Error('commit exploded'); return runGit(args, cwd, o); };
      expect(await squashMerge(r, 'HAL-4', 'fix(g): x', c.verified, { git: failCommit })).toEqual({ ok: false, error: expect.stringContaining('commit exploded') });
      expect(head(r, HAL_MAIN)).toBe(old);
      expect(head(m.dir)).toBe(old);
      expect(status(m.dir)).toBe('');
      let moved = '';
      const race: GitRunner = async (args, cwd, o) => {
        if (sub(args) === 'update-ref' && !moved) {
          moved = gitIn(r, 'commit-tree', '-p', old, '-m', 'someone else', `${old}^{tree}`);
          gitIn(r, 'update-ref', HAL_MAIN, moved);
        }
        return runGit(args, cwd, o);
      };
      expect((await squashMerge(r, 'HAL-4', 'fix(g): x', c.verified, { git: race })).ok).toBe(false);
      expect(head(r, HAL_MAIN)).toBe(moved);
      expect(head(m.dir)).toBe(old);
      expect(status(m.dir)).toBe('');
      await removeWorktree(r, 'HAL-4');
    });
    it('refuses a verified commit whose tree differs, or that does not sit on refs/hal/main', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const c = await candidate(r, 'HAL-6');
      expect(await squashMerge(r, 'HAL-6', 'x', { commit: c.verified.commit, tree: head(r, 'HEAD^{tree}') })).toEqual({ ok: false, error: expect.stringContaining('not the verified tree') });
      const d = await candidate(r, 'HAL-9', 'games/g/b.js', 'other\n');
      expect((await squashMerge(r, 'HAL-9', 'x', d.verified)).ok).toBe(true);
      await ensureMainWorktree(r);
      const res = await squashMerge(r, 'HAL-6', 'x', c.verified); // refs/hal/main moved since HAL-6 branched
      expect(res).toEqual({ ok: false, error: expect.stringContaining('main moved') });
      const m = mainWorktreeDir(r);
      expect(head(m)).toBe(head(r, HAL_MAIN));
      expect(status(m)).toBe('');
    });
  });

  describe('pushHalMain', () => {
    it('fast-forwards origin main, and is rejected (no force) when origin has diverged', async () => {
      const origin = bare();
      const r = fresh();
      gitIn(r, 'remote', 'add', 'origin', origin);
      gitIn(r, 'push', '-q', 'origin', 'main');
      await ensureMainWorktree(r);
      const c = await candidate(r, 'HAL-30');
      expect((await squashMerge(r, 'HAL-30', 'fix(g): pushed', c.verified)).ok).toBe(true);
      expect(await pushHalMain(r)).toEqual({ ok: true });
      expect(gitIn(origin, 'rev-parse', 'main')).toBe(head(r, HAL_MAIN));
      // Someone pushes; Hal merges another change on its own line: the push is a non-fast-forward.
      pushFrom(clone(origin), 'games/g/theirs.js');
      await ensureMainWorktree(r); // fast-forwards hal/main to theirs (ancestor), so diverge after it
      const theirs = gitIn(origin, 'rev-parse', 'main');
      const d = await candidate(r, 'HAL-31', 'games/g/b.js', 'mine\n');
      expect((await squashMerge(r, 'HAL-31', 'fix(g): mine', d.verified)).ok).toBe(true);
      pushFrom(clone(origin), 'games/g/theirs2.js');
      const res = await pushHalMain(r);
      expect(res.ok).toBe(false);
      expect(gitIn(origin, 'rev-parse', 'main')).not.toBe(head(r, HAL_MAIN));
      expect(gitIn(origin, 'merge-base', '--is-ancestor', theirs, 'main')).toBe('');
    });
  });

  describe('revertPass', () => {
    it('finds the merge commit of a pass on refs/hal/main by its Hal-Pass trailer, ignoring undo commits; null when absent', async () => {
      const r = fresh();
      await ensureMainWorktree(r);
      const trailers = (pass: string, extra = '') => `Hal-Pass: ${pass}\nHal-Game: g\nHal-Kind: fix\nHal-Why: w\nHal-Score-Before: 1\nHal-Score-After: 2\nHal-Version: 0.1.1\nHal-Run: r1${extra}`;
      const c = await candidate(r, 'HAL-10');
      const res = await squashMerge(r, 'HAL-10', `fix(g): ten\n\nwhy\n\n${trailers('HAL-10')}`, c.verified);
      expect(res.ok).toBe(true);
      await removeWorktree(r, 'HAL-10');
      await ensureMainWorktree(r);
      const u = await candidate(r, 'HAL-11', 'games/g/a.js', 'let a = 1;\n');
      expect((await squashMerge(r, 'HAL-11', `fix(g): undo ten\n\n${trailers('HAL-10', '\nHal-Undo: HAL-10\nHal-Reason: no')}`, u.verified)).ok).toBe(true);
      await removeWorktree(r, 'HAL-11');
      expect(await revertPass(r, 'HAL-10')).toBe(res.ok && res.commit);
      expect(await revertPass(r, 'HAL-404')).toBeNull();
      expect(await revertPass(r, 'HAL-1')).toBeNull();
    });
  });
});
