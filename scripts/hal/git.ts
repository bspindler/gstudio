// Hal's git helpers. Everything goes through an injectable runner so tests (and later helpers) can share one seam.
import { execFile, execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parseTrailers, type Diff, type FileChange } from '@studio/core/hal';

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
    let suspect = false;
    let symlinked = false;
    let binary = !isText && binaryPaths.has(r.path);
    // Fail closed: a path that is present and not deleted must be readable, or the whole collection throws (callers treat a throw as a discard).
    if (r.status !== 'D') {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) { symlinked = true; after = await readlink(abs); }
      else if (st.isFile()) {
        const buf = await readFile(abs);
        if (!isText && looksBinary(buf)) binary = true;
        if (isText && (buf.includes(0) || (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))))) suspect = true;
        after = binary ? null : buf.toString('utf8');
      } else throw new Error(`collectDiff: not a regular file or symlink: ${r.path}`);
    }
    let before: string | null = null;
    if (r.status !== 'A' && !binary) before = await git(['show', `${base}:${r.oldPath ?? r.path}`], root);
    files.push({ path: r.path, status: r.status, before, after, binary, ...(r.oldPath !== undefined ? { oldPath: r.oldPath } : {}), ...(symlinked ? { symlink: true } : {}), ...(suspect ? { suspectEncoding: true } : {}) });
  }

  const deleted = new Set(files.filter((f) => f.status === 'D').map((f) => f.path));
  const renamedAway = new Set(files.filter((f) => f.oldPath).map((f) => f.oldPath!));
  const repoFiles = [...new Set([...lines(trackedOut), ...lines(untrackedOut)])].filter((p) => !deleted.has(p) && !renamedAway.has(p));

  // Only a path truly absent at base has "no before count"; any other git failure throws.
  const baseText = async (file: string) => ((await git(['ls-tree', '--name-only', base, '--', file], root)).trim() === '' ? null : git(['show', `${base}:${file}`], root));
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

// ---- worktrees and merges ------------------------------------------------
//
// Layout: Hal works only under <repo>/.data/hal/wt/ (gitignored). `main/` is Hal's own worktree of main, `<pass>/` a
// candidate on branch `hal/<pass>`. Brian's checkout (the repo root, or any other worktree) is never written to.
//
// Hal's main worktree is always DETACHED at main's commit: git refuses to check out one branch in two worktrees, and
// Brian's checkout may well be on main. So refs/heads/main moves in exactly one way: `update-ref` with a compare-and-swap
// on the old value, after a squash commit whose tree has been verified to be the checked candidate tree. A crash at any
// point before that leaves main where it was; ensureMainWorktree resets the leftovers on the next run.

export type GitDeps = { git?: GitRunner };

const PASS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function checkPass(passId: string): void {
  if (!PASS_RE.test(passId) || passId.includes('..') || passId === 'main' || passId.endsWith('.lock')) throw new Error(`bad pass id: ${JSON.stringify(passId)}`);
}
export const worktreesDir = (repo: string) => join(resolve(repo), '.data', 'hal', 'wt');
export const mainWorktreeDir = (repo: string) => join(worktreesDir(repo), 'main');
export const candidateDir = (repo: string, passId: string) => { checkPass(passId); return join(worktreesDir(repo), passId); };
export const candidateBranch = (passId: string) => { checkPass(passId); return `hal/${passId}`; };

const MAIN = 'refs/heads/main';
const rev = async (git: GitRunner, ref: string, cwd: string) => (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)).trim();
const ok = async (p: Promise<unknown>) => { try { await p; return true; } catch { return false; } };
const errText = (e: unknown) => String((e as Error)?.message ?? e).trim();

/** Worktree paths (real paths) with each one's checked-out branch, from `git worktree list --porcelain`. */
async function worktreeList(git: GitRunner, repo: string): Promise<{ path: string; branch: string | null }[]> {
  const out = await git(['worktree', 'list', '--porcelain'], repo);
  return out.split(/\n\n+/).filter((b) => b.trim()).map((b) => {
    const path = /^worktree (.*)$/m.exec(b)?.[1] ?? '';
    const branch = /^branch (.*)$/m.exec(b)?.[1] ?? null;
    return { path, branch };
  });
}
const realOr = async (p: string) => { try { return await realpath(p); } catch { return resolve(p); } };

/**
 * Gives a worktree its own node_modules: symlinks to each entry of <repo>/node_modules, except that workspace packages
 * (`@studio/*`, linked by npm to ../../packages/...) point into the worktree, so its tests and scorers load the worktree's
 * code, not the checkout's. node_modules is gitignored, so this never shows in a diff. No-op without <repo>/node_modules.
 */
export async function linkNodeModules(dir: string, repo: string): Promise<void> {
  const src = join(resolve(repo), 'node_modules');
  let names: string[];
  try { names = await readdir(src); } catch { return; }
  const dst = join(dir, 'node_modules');
  await rm(dst, { recursive: true, force: true }); // unlinks symlinks, never follows them
  await mkdir(dst, { recursive: true });
  for (const name of names) {
    if (name.startsWith('.') && name !== '.bin') continue; // caches (.vite, .package-lock.json) stay per tree
    if (name === '@studio') {
      await mkdir(join(dst, name));
      for (const pkg of await readdir(join(src, name))) {
        const link = join(src, name, pkg);
        const st = await lstat(link);
        const target = st.isSymbolicLink() ? resolve(dirname(link), await readlink(link)) : link;
        const rel = relative(resolve(repo), target);
        const inRepo = rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !rel.startsWith('node_modules');
        await symlink(inRepo ? join(dir, rel) : target, join(dst, name, pkg), 'dir');
      }
      continue;
    }
    await symlink(join(src, name), join(dst, name));
  }
}

export type MainWorktree = {
  dir: string;
  /** main's commit, which the worktree now has checked out (detached). */
  head: string;
  /** Whether `git fetch origin main` worked. A failed fetch is not an error. */
  fetched: boolean;
  /** Whether main was fast-forwarded to origin/main. */
  fastForwarded: boolean;
  /** Other worktrees (e.g. Brian's checkout) that have main checked out. Their files are never touched, but their HEAD moves with main. */
  mainCheckedOutAt: string[];
};

/**
 * Creates (or repairs) Hal's worktree of main at <repo>/.data/hal/wt/main, detached at main, with every leftover
 * (staged, modified, untracked) discarded. Fast-forwards main from origin/main first when a fetch works; never rewinds
 * or forks main. Brian's checkout is never written to.
 */
export async function ensureMainWorktree(repo: string, deps: GitDeps = {}): Promise<MainWorktree> {
  const git = deps.git ?? runGit;
  const root = resolve(repo);
  const dir = mainWorktreeDir(root);
  await git(['worktree', 'prune'], root);

  let fetched = false, fastForwarded = false;
  if (await ok(git(['remote', 'get-url', 'origin'], root))) {
    fetched = await ok(git(['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'], root));
    if (fetched) {
      const local = await rev(git, MAIN, root);
      const remote = await rev(git, 'refs/remotes/origin/main', root);
      if (local !== remote && (await ok(git(['merge-base', '--is-ancestor', local, remote], root)))) {
        await git(['update-ref', '-m', 'hal: fast-forward main from origin/main', MAIN, remote, local], root);
        fastForwarded = true;
      }
    }
  }

  const real = await realOr(dir);
  const list = await worktreeList(git, root);
  if (!list.some((w) => w.path === real || w.path === dir)) {
    await rm(dir, { recursive: true, force: true }); // a stray directory that is not a registered worktree
    await mkdir(dirname(dir), { recursive: true });
    await git(['worktree', 'add', '--detach', '--force', dir, MAIN], root);
  }
  await git(['reset', '--hard', '--quiet'], dir);
  await git(['clean', '-fdq'], dir);
  await git(['checkout', '--detach', '--force', '--quiet', MAIN], dir);
  const head = await rev(git, 'HEAD', dir);
  const main = await rev(git, MAIN, root);
  if (head !== main) throw new Error(`main worktree is at ${head}, not main (${main})`);
  await linkNodeModules(dir, root);
  const mainCheckedOutAt = (await worktreeList(git, root)).filter((w) => w.branch === MAIN).map((w) => w.path);
  return { dir, head, fetched, fastForwarded, mainCheckedOutAt };
}

export type CandidateWorktree = { dir: string; branch: string; base: string };

/** Creates branch hal/<pass> at main's commit, checked out at <repo>/.data/hal/wt/<pass>. Clears a stale one of the same pass first. */
export async function newCandidateWorktree(repo: string, passId: string, deps: GitDeps = {}): Promise<CandidateWorktree> {
  const git = deps.git ?? runGit;
  const root = resolve(repo);
  const dir = candidateDir(root, passId);
  const branch = candidateBranch(passId);
  await removeWorktree(root, passId, deps);
  const base = await rev(git, MAIN, root);
  await mkdir(dirname(dir), { recursive: true });
  await git(['worktree', 'add', '--quiet', '-b', branch, dir, base], root);
  await linkNodeModules(dir, root);
  return { dir, branch, base };
}

/** Removes the candidate worktree and deletes its branch. Never throws: it runs in `finally`. */
export async function removeWorktree(repo: string, passId: string, deps: GitDeps = {}): Promise<void> {
  const git = deps.git ?? runGit;
  const root = resolve(repo);
  let dir: string, branch: string;
  try { dir = candidateDir(root, passId); branch = candidateBranch(passId); } catch { return; }
  await ok(git(['worktree', 'remove', '--force', '--force', dir], root));
  await ok(rm(dir, { recursive: true, force: true }));
  await ok(git(['worktree', 'prune'], root));
  await ok(git(['branch', '-D', '--quiet', branch], root));
}

export type SquashResult = { ok: true; commit: string } | { ok: false; error: string };

/**
 * Squash-merges hal/<pass> into main as one commit with `message`, in Hal's main worktree (ensureMainWorktree first).
 * main only moves if the new commit's parent is the recorded pre-merge HEAD and its tree is exactly the candidate's tree,
 * and then only by a compare-and-swap `update-ref`. On any failure the main worktree is reset to the recorded pre-merge
 * HEAD (not ORIG_HEAD) and cleaned, and `{ ok: false }` is returned; main itself is never left moved or half-merged.
 */
export async function squashMerge(repo: string, passId: string, message: string, deps: GitDeps = {}): Promise<SquashResult> {
  const git = deps.git ?? runGit;
  const root = resolve(repo);
  const dir = mainWorktreeDir(root);
  let pre: string;
  try {
    const branch = candidateBranch(passId);
    pre = await rev(git, 'HEAD', dir);
    const main = await rev(git, MAIN, root);
    if (pre !== main) return { ok: false, error: `main worktree is at ${pre}, not main (${main}); run ensureMainWorktree first` };
    if ((await git(['status', '--porcelain', '--untracked-files=all'], dir)).trim() !== '') return { ok: false, error: 'main worktree is not clean' };
    const candTree = (await git(['rev-parse', `refs/heads/${branch}^{tree}`], root)).trim();
    try {
      await git(['merge', '--squash', '--quiet', `refs/heads/${branch}`], dir);
      await git(['commit', '--quiet', '--cleanup=whitespace', '-m', message], dir);
      const commit = await rev(git, 'HEAD', dir);
      if ((await rev(git, 'HEAD^', dir)) !== pre) throw new Error('squash commit does not sit on the pre-merge HEAD');
      const tree = (await git(['rev-parse', 'HEAD^{tree}'], dir)).trim();
      if (tree !== candTree) throw new Error(`merged tree ${tree} is not the checked candidate tree ${candTree} (main moved since the candidate branched)`);
      await git(['update-ref', '-m', `hal: squash ${passId}`, MAIN, commit, pre], root);
      return { ok: true, commit };
    } catch (e) {
      const error = errText(e);
      await ok(git(['reset', '--hard', '--quiet', pre], dir));
      await ok(git(['clean', '-fdq'], dir));
      return { ok: false, error };
    }
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** The commit on main that merged `passId` (by its Hal-Pass trailer; undo commits are skipped), or null. Task 7 does the undo. */
export async function revertPass(repo: string, passId: string, deps: GitDeps = {}): Promise<string | null> {
  const git = deps.git ?? runGit;
  const out = await git(['log', '--format=%H%x00%B%x1e', MAIN], resolve(repo));
  for (const rec of out.split('\x1e')) {
    const i = rec.indexOf('\0');
    if (i < 0) continue;
    const t = parseTrailers(rec.slice(i + 1));
    if (t && t.pass === passId && t.undo === undefined) return rec.slice(0, i).trim();
  }
  return null;
}
