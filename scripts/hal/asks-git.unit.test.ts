// The git side of "Hal asks" against a real temp repo: applying the implementer's patch to a tree object (never the
// worktree), reading back what it changed, writing those files to disk without following a planted symlink, and the
// protected diff the report shows.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPatchToTree, extendTree, materializePaths, rawChanges, snapshotTree, treePatch } from './git.js';

const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const TEST = 'packages/core/test/hal-hyperline-score.test.ts';
const patch = (path: string, from: string, to: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n one\n-${from}\n+${to}\n three\n`;

describe('asks: patch a tree object', () => {
  let repo: string, tree: string, tmp: string;
  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'hal-asks-git-')));
    tmp = join(repo, '.data', 'tmp');
    gitIn(repo, 'init', '-q', '-b', 'main');
    put(repo, TEST, 'one\nexpect(levels).toBe(3);\nthree\n');
    put(repo, 'games/hyperline/game.js', 'export const n = 3;\n');
    put(repo, '.gitignore', '.data/\n');
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'base');
    tree = gitIn(repo, 'rev-parse', 'HEAD^{tree}');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('applies to the tree object only (the disk and the real index are untouched) and reports what changed', async () => {
    const out = await applyPatchToTree(repo, tree, patch(TEST, 'expect(levels).toBe(3);', 'expect(levels).toBe(LEVELS.length);'), { tmpRoot: tmp });
    expect(out).not.toBe(tree);
    expect(gitIn(repo, 'cat-file', 'blob', `${out}:${TEST}`)).toContain('LEVELS.length');
    expect(readFileSync(join(repo, TEST), 'utf8')).toContain('toBe(3)');
    expect(gitIn(repo, 'status', '--porcelain')).toBe('');
    const ch = await rawChanges(repo, tree, out);
    expect(ch).toEqual([{ path: TEST, status: 'M', oldMode: '100644', newMode: '100644', before: 'one\nexpect(levels).toBe(3);\nthree\n', after: 'one\nexpect(levels).toBe(LEVELS.length);\nthree\n' }]);
    const shown = await treePatch(repo, tree, out, [TEST]);
    expect(shown).toContain(`+++ b/${TEST}`);
    expect(shown).toContain('+expect(levels).toBe(LEVELS.length);');
  });

  it('tolerates wrong hunk counts (--recount) but not wrong context', async () => {
    const off = `diff --git a/${TEST} b/${TEST}\n--- a/${TEST}\n+++ b/${TEST}\n@@ -1,9 +1,9 @@\n one\n-expect(levels).toBe(3);\n+expect(levels).toBe(4);\n three\n`;
    await expect(applyPatchToTree(repo, tree, off, { tmpRoot: tmp })).resolves.toMatch(/^[0-9a-f]{40}$/);
    await expect(applyPatchToTree(repo, tree, patch(TEST, 'no such line', 'x'), { tmpRoot: tmp })).rejects.toThrow(/patch does not apply/);
  });

  it('refuses a patch that escapes the repo (git apply\'s own path checks, no --unsafe-paths)', async () => {
    const esc = 'diff --git a/../outside.txt b/../outside.txt\nnew file mode 100644\n--- /dev/null\n+++ b/../outside.txt\n@@ -0,0 +1 @@\n+x\n';
    await expect(applyPatchToTree(repo, tree, esc, { tmpRoot: tmp })).rejects.toThrow();
    expect(existsSync(join(dirname(repo), 'outside.txt'))).toBe(false);
  });

  it('materializes the patched files onto disk, and the disk then hashes to the patched tree', async () => {
    const out = await applyPatchToTree(repo, tree, patch(TEST, 'expect(levels).toBe(3);', 'expect(levels).toBe(4);'), { tmpRoot: tmp });
    await materializePaths(repo, out, [TEST]);
    expect(readFileSync(join(repo, TEST), 'utf8')).toContain('toBe(4)');
    expect(await extendTree(repo, tree, [TEST], { tmpRoot: tmp })).toBe(out);
    // And back: a path absent from the tree is removed, a present one rewritten.
    await materializePaths(repo, tree, [TEST]);
    expect(readFileSync(join(repo, TEST), 'utf8')).toContain('toBe(3)');
  });

  it('never writes through a symlinked folder or file planted on the way', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'hal-asks-out-')));
    try {
      const out = await applyPatchToTree(repo, tree, patch(TEST, 'expect(levels).toBe(3);', 'expect(levels).toBe(4);'), { tmpRoot: tmp });
      rmSync(join(repo, 'packages/core/test'), { recursive: true });
      symlinkSync(outside, join(repo, 'packages/core/test'));
      await expect(materializePaths(repo, out, [TEST])).rejects.toThrow(/symlink/);
      expect(existsSync(join(outside, 'hal-hyperline-score.test.ts'))).toBe(false);
      rmSync(join(repo, 'packages/core/test'));
      mkdirSync(join(repo, 'packages/core/test'));
      symlinkSync(join(outside, 'target.ts'), join(repo, TEST));
      await expect(materializePaths(repo, out, [TEST])).rejects.toThrow(/symlink/);
      expect(existsSync(join(outside, 'target.ts'))).toBe(false);
      await expect(materializePaths(repo, out, ['../escape.ts'])).rejects.toThrow(/bad path/);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('a snapshot of the materialized disk equals the patched tree (what Hal guards between checks)', async () => {
    const out = await applyPatchToTree(repo, tree, patch(TEST, 'expect(levels).toBe(3);', 'expect(levels).toBe(4);'), { tmpRoot: tmp });
    await materializePaths(repo, out, [TEST]);
    expect(await snapshotTree(repo, 'HEAD', { tmpRoot: tmp })).toBe(out);
  });
});
