// Hal's git helpers. Everything goes through an injectable runner so tests (and later helpers) can share one seam.
import { execFile, execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, readlink, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Diff, FileChange } from '@studio/core/hal';

const exec = promisify(execFile);

/** Runs `git <args>` in `cwd` and resolves to stdout (utf8); rejects on a non-zero exit. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = async (args, cwd) => {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return stdout;
};

// ---- level counts --------------------------------------------------------

/** Where each game's level list lives, and the array literal to count. Tidepool's hand-authored list is `RAW` (`AUTHORED` is derived from it). */
export const LEVEL_SOURCES: { game: string; file: string; array: string }[] = [
  { game: 'tidepool-pals', file: 'games/tidepool-pals/levels.js', array: 'RAW' },
  { game: 'gearhold', file: 'games/gearhold/levels.js', array: 'LEVELS' },
];

/**
 * Counts the top-level elements of `const NAME = [ ... ]` by scanning the text (strings, template literals and comments
 * are skipped, brackets are matched), so no game code is executed. Returns null if the array is not found or not closed.
 */
export function countArrayItems(src: string, name: string): number | null {
  const m = new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*\\[`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let items = 0;
  let pending = false; // content seen since the last top-level comma
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      pending = true;
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      if (i >= src.length) return null;
      i++;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') { depth++; pending = true; }
    else if (c === ']' || c === ')' || c === '}') {
      depth--;
      if (depth === 0) return items + (pending ? 1 : 0);
    } else if (c === ',' && depth === 1) { if (pending) items++; pending = false; }
    else if (!/\s/.test(c)) pending = true;
    i++;
  }
  return null;
}

function levelCounts(read: (file: string) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of LEVEL_SOURCES) {
    const src = read(s.file);
    const n = src === null ? null : countArrayItems(src, s.array);
    if (n !== null) out[s.game] = n;
  }
  return out;
}

// ---- test counts ---------------------------------------------------------

/** Counts tests with `npx vitest list --json` in `dir` (the repo's default workspace). Slow, so collectDiff takes it as a dependency. */
export async function vitestCount(dir: string): Promise<{ total: number; byFile: Record<string, number> }> {
  const { stdout } = await exec('npx', ['vitest', 'list', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: '1' } });
  const start = stdout.indexOf('[');
  const parsed: unknown = JSON.parse(stdout.slice(start));
  if (!Array.isArray(parsed)) throw new Error('vitest list --json did not return an array');
  const byFile: Record<string, number> = {};
  const prefix = (await realpath(dir)) + sep; // temp dirs are often symlinked (macOS /var -> /private/var) and vitest reports real paths
  for (const t of parsed as { file?: string }[]) {
    const file = (t.file ?? '').startsWith(prefix) ? t.file!.slice(prefix.length) : (t.file ?? '');
    byFile[file.split(sep).join('/')] = (byFile[file.split(sep).join('/')] ?? 0) + 1;
  }
  return { total: parsed.length, byFile };
}

/** Default test counter: the candidate worktree as it is, and the base exported with `git archive` into a temp dir that borrows the worktree's node_modules. */
export async function vitestCounts(worktree: string, base: string): Promise<TestCounts> {
  const tmp = await mkdtemp(join(tmpdir(), 'hal-base-'));
  try {
    // No shell pipe: a failing `git archive` throws instead of leaving an empty tree to count as zero tests.
    const tar = execFileSync('git', ['archive', '--format=tar', base], { cwd: worktree, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('tar', ['-x', '-C', tmp], { input: tar, stdio: ['pipe', 'pipe', 'pipe'] });
    await symlink(join(worktree, 'node_modules'), join(tmp, 'node_modules'), 'dir');
    const before = await vitestCount(tmp);
    const after = await vitestCount(worktree);
    return { before: before.total, after: after.total, beforeByFile: before.byFile, afterByFile: after.byFile };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---- diff collection -----------------------------------------------------

export type TestCounts = { before: number; after: number; beforeByFile?: Record<string, number>; afterByFile?: Record<string, number> };
export type CollectDeps = {
  git?: GitRunner;
  countTests?: (worktree: string, base: string) => Promise<TestCounts>;
};

/** Source and text formats are always decoded and scanned, whatever git (or a .gitattributes `-diff`, or a stray NUL byte) says about them. */
const TEXT_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'html', 'htm', 'css', 'json', 'svg', 'md', 'txt', 'yaml', 'yml']);
const extOf = (p: string) => (p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '');

const STATUS: Record<string, FileChange['status']> = { A: 'A', M: 'M', D: 'D', R: 'R', C: 'A', T: 'M' };
const looksBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0);

/** Parses `git diff --name-status -z -M` output into [status, path, oldPath?] rows. */
function parseNameStatus(out: string): { status: FileChange['status']; path: string; oldPath?: string }[] {
  const t = out.split('\0');
  const rows: { status: FileChange['status']; path: string; oldPath?: string }[] = [];
  for (let i = 0; i < t.length && t[i]; ) {
    const code = t[i]![0]!;
    if (code === 'R' || code === 'C') { rows.push({ status: STATUS[code]!, path: t[i + 2]!, ...(code === 'R' ? { oldPath: t[i + 1]! } : {}) }); i += 3; }
    else { rows.push({ status: STATUS[code] ?? 'M', path: t[i + 1]! }); i += 2; }
  }
  return rows;
}

/** Paths git calls binary (`-` in numstat), by their new path. */
function parseBinary(out: string): Set<string> {
  const t = out.split('\0');
  const bin = new Set<string>();
  for (let i = 0; i < t.length && t[i]; ) {
    const m = /^(\S+)\t(\S+)\t([\s\S]*)$/.exec(t[i]!);
    if (!m) { i++; continue; }
    if (m[3] === '') { if (m[1] === '-') bin.add(t[i + 2]!); i += 3; }
    else { if (m[1] === '-') bin.add(m[3]!); i++; }
  }
  return bin;
}

const lines = (s: string) => s.split('\0').filter(Boolean);

/**
 * Everything the tripwires need about the candidate in `worktree` relative to `base`: changed files (tracked edits, renames,
 * deletes, and new untracked files) with before/after text, binary and symlink flags, level counts and test counts.
 * Symlinks are never followed: `after` holds the link target. Fails closed: any unreadable path, or a failing `git show` for a
 * non-added file, throws; the caller must treat a throw as a discard.
 */
export async function collectDiff(worktree: string, base: string, deps: CollectDeps = {}): Promise<Diff> {
  const git = deps.git ?? runGit;
  const root = resolve(worktree);
  const [nameStatus, numstat, untrackedOut, trackedOut] = await Promise.all([
    git(['diff', '--name-status', '-z', '-M', base], root),
    git(['diff', '--numstat', '-z', '-M', base], root),
    git(['ls-files', '--others', '--exclude-standard', '-z'], root),
    git(['ls-files', '-z'], root),
  ]);
  const rows = parseNameStatus(nameStatus);
  const known = new Set(rows.map((r) => r.path));
  for (const p of lines(untrackedOut)) if (!known.has(p)) rows.push({ status: 'A', path: p });
  const binaryPaths = parseBinary(numstat);

  const files: FileChange[] = [];
  for (const r of rows) {
    const abs = resolve(root, r.path);
    if (!(abs === root || abs.startsWith(root + sep))) throw new Error(`collectDiff: path escapes the worktree: ${r.path}`);
    const isText = TEXT_EXT.has(extOf(r.path));
    let after: string | null = null;
    let symlinked = false;
    let binary = !isText && binaryPaths.has(r.path);
    // Fail closed: a path that is present and not deleted must be readable, or the whole collection throws (callers treat a throw as a discard).
    if (r.status !== 'D') {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) { symlinked = true; after = await readlink(abs); }
      else if (st.isFile()) {
        const buf = await readFile(abs);
        if (!isText && looksBinary(buf)) binary = true;
        after = binary ? null : buf.toString('utf8');
      } else throw new Error(`collectDiff: not a regular file or symlink: ${r.path}`);
    }
    let before: string | null = null;
    if (r.status !== 'A' && !binary) before = await git(['show', `${base}:${r.oldPath ?? r.path}`], root);
    files.push({ path: r.path, status: r.status, before, after, binary, ...(r.oldPath !== undefined ? { oldPath: r.oldPath } : {}), ...(symlinked ? { symlink: true } : {}) });
  }

  const deleted = new Set(files.filter((f) => f.status === 'D').map((f) => f.path));
  const renamedAway = new Set(files.filter((f) => f.oldPath).map((f) => f.oldPath!));
  const repoFiles = [...new Set([...lines(trackedOut), ...lines(untrackedOut)])].filter((p) => !deleted.has(p) && !renamedAway.has(p));

  const baseText = async (file: string) => { try { return await git(['show', `${base}:${file}`], root); } catch { return null; } };
  const beforeTexts = new Map<string, string | null>();
  for (const s of LEVEL_SOURCES) beforeTexts.set(s.file, await baseText(s.file));
  const afterText = async (file: string) => {
    const abs = resolve(root, file);
    try { await lstat(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    const st = await lstat(abs);
    return st.isFile() ? await readFile(abs, 'utf8') : null;
  };
  const afterTexts = new Map<string, string | null>();
  for (const s of LEVEL_SOURCES) afterTexts.set(s.file, await afterText(s.file));

  const tests = await (deps.countTests ?? vitestCounts)(root, base);
  return {
    files,
    testCountBefore: tests.before,
    testCountAfter: tests.after,
    ...(tests.beforeByFile && tests.afterByFile ? { testCountsByFile: { before: tests.beforeByFile, after: tests.afterByFile } } : {}),
    levelCounts: { before: levelCounts((f) => beforeTexts.get(f) ?? null), after: levelCounts((f) => afterTexts.get(f) ?? null) },
    repoFiles,
  };
}
