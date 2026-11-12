// Hal's git helpers. Everything goes through an injectable runner so tests (and later helpers) can share one seam.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parseTrailers, type Diff, type FileChange } from '@studio/core/hal';

const exec = promisify(execFile);

export type GitOpts = { env?: NodeJS.ProcessEnv; input?: string | Buffer };
/** Runs `git <args>` in `cwd` and resolves to stdout (utf8); rejects on a non-zero exit. `opts.env` replaces the env; `opts.input` is stdin. */
export type GitRunner = (args: string[], cwd: string, opts?: GitOpts) => Promise<string>;

/** Raw bytes of `git <args>` stdout. Rejects on a non-zero exit with "Command failed: git ..." and the stderr. */
export function gitBytes(args: string[], cwd: string, opts: GitOpts = {}): Promise<Buffer> {
  return new Promise((resolveP, reject) => {
    const child = spawn('git', args, { cwd, env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveP(Buffer.concat(out));
      else reject(new Error(`Command failed: git ${args.join(' ')}\n${Buffer.concat(err).toString('utf8')}`));
    });
    child.stdin.on('error', () => { /* EPIPE if git exits early */ });
    child.stdin.end(opts.input ?? '');
  });
}

export const runGit: GitRunner = async (args, cwd, opts) => (await gitBytes(args, cwd, opts)).toString('utf8');

/** Config for every git call Hal makes in a worktree: no hooks, no fsmonitor daemon. */
export const SAFE_GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

/** How long one read-only git call from the report server or the History pages may take. */
export const GIT_TIMEOUT_MS = 10_000;

/** The env Hal's own git calls get: no Claude credentials, no Hal token, no inherited GIT_* overrides. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^GIT_/.test(k) || /^(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|HAL_TOKEN)$/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

/** Wraps a runner so every call carries SAFE_GIT and the scrubbed env (plus any `opts.env` additions, e.g. GIT_INDEX_FILE). */
export function safeGit(git: GitRunner = runGit): GitRunner {
  return (args, cwd, opts) => git([...SAFE_GIT, ...args], cwd, { ...opts, env: { ...gitEnv(), ...(opts?.env ?? {}) } });
}
const safeBytes = (args: string[], cwd: string, opts: GitOpts = {}) => gitBytes([...SAFE_GIT, ...args], cwd, { ...opts, env: { ...gitEnv(), ...(opts.env ?? {}) } });

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
/** Runs `vitest list --json` in `dir` and resolves to its stdout. Hal passes a sandboxed one for candidates (the listing runs their test files). */
export type ListTests = (dir: string) => Promise<string>;
export const npxVitestList: ListTests = async (dir) =>
  (await exec('npx', ['vitest', 'list', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: '1' } })).stdout;

export async function vitestCount(dir: string, list: ListTests = npxVitestList): Promise<{ total: number; byFile: Record<string, number> }> {
  const stdout = await list(dir);
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

export type CountOptions = {
  /** Where the base export goes (default os.tmpdir()); runCandidate passes a dir the checks cannot write. */
  tmpRoot?: string;
  /** Repo whose node_modules the base export links (workspace packages pointing into the export). Default: borrow the worktree's. */
  repo?: string;
};

/**
 * Default test counter: the candidate worktree as it is, and the base exported with `git archive` (SAFE_GIT, scrubbed
 * env) into a temp dir with node_modules.
 */
export async function vitestCounts(worktree: string, base: string, list: ListTests = npxVitestList, o: CountOptions = {}): Promise<TestCounts> {
  const tmp = await (async () => { const r = o.tmpRoot ?? tmpdir(); await mkdir(r, { recursive: true }); return mkdtemp(join(r, 'hal-base-')); })();
  try {
    // No shell pipe: a failing `git archive` throws instead of leaving an empty tree to count as zero tests.
    const tar = await safeBytes(['archive', '--format=tar', base], worktree);
    execFileSync('tar', ['-x', '-C', tmp], { input: tar, stdio: ['pipe', 'pipe', 'pipe'] });
    if (o.repo) await linkNodeModules(tmp, o.repo);
    else await symlink(join(worktree, 'node_modules'), join(tmp, 'node_modules'), 'dir');
    const before = await vitestCount(tmp, list);
    const after = await vitestCount(worktree, list);
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

/** collectDiff's rules for a file's bytes: text formats are always decoded (NUL or UTF-16 BOM flags them suspect), others are binary if git or a NUL says so. */
function decode(buf: Buffer, isText: boolean, gitBinary: boolean): { after: string | null; binary: boolean; suspect: boolean } {
  const binary = gitBinary || (!isText && looksBinary(buf));
  const suspect = isText && (buf.includes(0) || (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))));
  return { after: binary ? null : buf.toString('utf8'), binary, suspect };
}

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
        const d = decode(await readFile(abs), isText, binary);
        binary = d.binary; suspect = d.suspect; after = d.after;
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
// Hal never writes Brian's branches (ruling R12). Hal's line of history is refs/hal/main; its worktree at
// <repo>/.data/hal/wt/main is detached at that ref, and candidates (<repo>/.data/hal/wt/<pass>, branch hal/<pass>) start
// from it. refs/hal/main moves only by compare-and-swap `update-ref`, to a commit whose tree is the verified candidate
// tree; pushHalMain publishes it to origin's main fast-forward only. refs/heads/main, Brian's checkout, its HEAD, index
// and files are never written. A crash at any point leaves refs/hal/main at its old commit.

export const HAL_MAIN = 'refs/hal/main';
export type GitDeps = { git?: GitRunner };

const PASS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function checkPass(passId: string): void {
  if (!PASS_RE.test(passId) || passId.includes('..') || passId === 'main' || passId.endsWith('.lock')) throw new Error(`bad pass id: ${JSON.stringify(passId)}`);
}
export const worktreesDir = (repo: string) => join(resolve(repo), '.data', 'hal', 'wt');
export const mainWorktreeDir = (repo: string) => join(worktreesDir(repo), 'main');
export const candidateDir = (repo: string, passId: string) => { checkPass(passId); return join(worktreesDir(repo), passId); };
export const candidateBranch = (passId: string) => { checkPass(passId); return `hal/${passId}`; };

const rev = async (git: GitRunner, ref: string, cwd: string) => (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)).trim();
const revOrNull = async (git: GitRunner, ref: string, cwd: string) => { try { return await rev(git, ref, cwd); } catch { return null; } };
const ok = async (p: Promise<unknown>) => { try { await p; return true; } catch { return false; } };
const errText = (e: unknown) => String((e as Error)?.message ?? e).trim();

async function worktreePaths(git: GitRunner, repo: string): Promise<string[]> {
  const out = await git(['worktree', 'list', '--porcelain'], repo);
  return [...out.matchAll(/^worktree (.*)$/gm)].map((m) => m[1]!);
}
const realOr = async (p: string) => { try { return await realpath(p); } catch { return resolve(p); } };

/**
 * Gives a worktree its own node_modules: symlinks to each entry of <repo>/node_modules, except that workspace packages
 * (`@studio/*`, linked by npm to ../../packages/...) point into the worktree, so its tests and scorers load the worktree's
 * code, not the checkout's. node_modules is gitignored, so this never shows in a diff. No-op without <repo>/node_modules.
 */
export async function linkNodeModules(dir: string, repo: string): Promise<Map<string, string>> {
  const links = await expectedNodeModules(dir, repo);
  const dst = join(dir, 'node_modules');
  await rm(dst, { recursive: true, force: true }); // unlinks symlinks, never follows them
  if (links.size === 0) return links;
  await mkdir(join(dst, '@studio'), { recursive: true });
  for (const [rel, target] of links) await symlink(target, join(dst, rel), rel.startsWith('@studio/') ? 'dir' : undefined);
  return links;
}

/** What linkNodeModules makes: entry (relative to node_modules) -> symlink target. Read from <repo>/node_modules. */
async function expectedNodeModules(dir: string, repo: string): Promise<Map<string, string>> {
  const src = join(resolve(repo), 'node_modules');
  const links = new Map<string, string>();
  let names: string[];
  try { names = await readdir(src); } catch { return links; }
  for (const name of names) {
    if (name.startsWith('.') && name !== '.bin') continue; // caches (.vite, .package-lock.json) stay per tree
    if (name === '@studio') {
      for (const pkg of await readdir(join(src, name))) {
        const link = join(src, name, pkg);
        const st = await lstat(link);
        const target = st.isSymbolicLink() ? resolve(dirname(link), await readlink(link)) : link;
        const rel = relative(resolve(repo), target);
        const inRepo = rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !rel.startsWith('node_modules');
        links.set(`${name}/${pkg}`, inRepo ? join(dir, rel) : target);
      }
      continue;
    }
    links.set(name, join(src, name));
  }
  return links;
}

/**
 * Throws unless <dir>/node_modules is exactly what linkNodeModules makes: a real directory (and @studio/ in it) holding
 * only symlinks, each to its expected target. Run after relinking, before every isolated check.
 */
export async function verifyNodeModules(dir: string, repo: string): Promise<void> {
  const want = await expectedNodeModules(dir, repo);
  const dst = join(dir, 'node_modules');
  if (want.size === 0) { if (await ok(lstat(dst))) throw new Error('node_modules: present but nothing to link'); return; }
  const top = await lstat(dst);
  if (!top.isDirectory() || top.isSymbolicLink()) throw new Error('node_modules: not a real directory');
  const seen = new Set<string>();
  for (const name of await readdir(dst)) {
    if (name === '@studio') {
      const st = await lstat(join(dst, name));
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('node_modules/@studio: not a real directory');
      for (const pkg of await readdir(join(dst, name))) seen.add(`${name}/${pkg}`);
    } else seen.add(name);
  }
  for (const rel of seen) if (!want.has(rel)) throw new Error(`node_modules: unexpected entry ${rel}`);
  for (const [rel, target] of want) {
    const p = join(dst, rel);
    const st = await lstat(p).catch(() => null);
    if (!st?.isSymbolicLink() || (await readlink(p)) !== target) throw new Error(`node_modules: ${rel} is not a link to ${target}`);
  }
}

/**
 * A digest of the trust root <repo>/node_modules: every installed package's package.json, the .bin links, and the entry
 * files of the tools Hal runs checks with (vitest, tsc, tsx). Compared across a pass to catch writes through a
 * worktree's node_modules symlinks.
 */
export async function trustRootDigest(repo: string): Promise<string> {
  const nm = join(resolve(repo), 'node_modules');
  const h = createHash('sha256');
  const file = async (rel: string) => {
    const buf = await readFile(join(nm, rel)).catch(() => null);
    h.update(`${rel}\0${buf ? createHash('sha256').update(buf).digest('hex') : 'missing'}\n`);
  };
  let names: string[];
  try { names = (await readdir(nm)).sort(); } catch { return 'no node_modules'; }
  for (const name of names) {
    if (name === '.bin') {
      for (const b of (await readdir(join(nm, name))).sort()) h.update(`bin ${b} -> ${await readlink(join(nm, name, b)).catch(() => 'not a link')}\n`);
    } else if (name.startsWith('@')) {
      for (const pkg of (await readdir(join(nm, name)).catch(() => [] as string[])).sort()) await file(`${name}/${pkg}/package.json`);
    } else if (!name.startsWith('.')) await file(`${name}/package.json`);
  }
  for (const f of ['vitest/vitest.mjs', 'typescript/bin/tsc', 'tsx/dist/cli.mjs']) await file(f);
  return h.digest('hex');
}

export type MainWorktree = {
  dir: string;
  /** refs/hal/main's commit, which the worktree now has checked out (detached). */
  head: string;
  /** Whether `git fetch origin main` worked. A failed fetch (or no origin) is not an error. */
  fetched: boolean;
  /** Whether refs/hal/main was fast-forwarded to origin/main. */
  fastForwarded: boolean;
  /** refs/hal/main and origin/main have both moved on (Hal has unpushed commits and origin moved): left as is; skip the push and report it. */
  diverged: boolean;
};

/**
 * Creates (or repairs) Hal's worktree at <repo>/.data/hal/wt/main, detached at refs/hal/main, with every leftover
 * (staged, modified, untracked) discarded. refs/hal/main is created from origin/main after a successful fetch, else
 * from local main; an existing one is fast-forwarded to origin/main when it is an ancestor of it, and never rewound.
 */
export async function ensureMainWorktree(repo: string, deps: GitDeps = {}): Promise<MainWorktree> {
  const git = safeGit(deps.git ?? runGit);
  const root = resolve(repo);
  const dir = mainWorktreeDir(root);
  await git(['worktree', 'prune'], root);

  let fetched = false, fastForwarded = false, diverged = false;
  if (await ok(git(['remote', 'get-url', 'origin'], root))) {
    fetched = await ok(git(['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'], root));
  }
  const remote = fetched ? await rev(git, 'refs/remotes/origin/main', root) : null;
  const hal = await revOrNull(git, HAL_MAIN, root);
  if (hal === null) {
    const from = remote ?? (await rev(git, 'refs/heads/main', root));
    await git(['update-ref', '-m', 'hal: create refs/hal/main', HAL_MAIN, from, ''], root);
  } else if (remote !== null && remote !== hal) {
    if (await ok(git(['merge-base', '--is-ancestor', hal, remote], root))) {
      await git(['update-ref', '-m', 'hal: fast-forward from origin/main', HAL_MAIN, remote, hal], root);
      fastForwarded = true;
    } else if (!(await ok(git(['merge-base', '--is-ancestor', remote, hal], root)))) diverged = true;
  }

  const real = await realOr(dir);
  if (!(await worktreePaths(git, root)).some((w) => w === real || w === dir)) {
    await rm(dir, { recursive: true, force: true }); // a stray directory that is not a registered worktree
    await mkdir(dirname(dir), { recursive: true });
    await git(['worktree', 'add', '--detach', '--force', dir, HAL_MAIN], root);
  }
  await git(['reset', '--hard', '--quiet'], dir);
  await git(['clean', '-fdq'], dir);
  await git(['checkout', '--detach', '--force', '--quiet', HAL_MAIN], dir);
  const head = await rev(git, 'HEAD', dir);
  const want = await rev(git, HAL_MAIN, root);
  if (head !== want) throw new Error(`main worktree is at ${head}, not ${HAL_MAIN} (${want})`);
  await linkNodeModules(dir, root);
  return { dir, head, fetched, fastForwarded, diverged };
}

export type CandidateWorktree = { dir: string; branch: string; base: string };

/** Creates branch hal/<pass> at refs/hal/main, checked out at <repo>/.data/hal/wt/<pass>. Clears a stale one of the same pass first. */
export async function newCandidateWorktree(repo: string, passId: string, deps: GitDeps = {}): Promise<CandidateWorktree> {
  const git = safeGit(deps.git ?? runGit);
  const root = resolve(repo);
  const dir = candidateDir(root, passId);
  const branch = candidateBranch(passId);
  await removeWorktree(root, passId, deps);
  const base = await rev(git, HAL_MAIN, root);
  await mkdir(dirname(dir), { recursive: true });
  await git(['worktree', 'add', '--quiet', '-b', branch, dir, base], root);
  await linkNodeModules(dir, root);
  return { dir, branch, base };
}

/** Removes the candidate worktree and deletes its branch. Never throws: it runs in `finally`. */
export async function removeWorktree(repo: string, passId: string, deps: GitDeps = {}): Promise<void> {
  const git = safeGit(deps.git ?? runGit);
  const root = resolve(repo);
  let dir: string, branch: string;
  try { dir = candidateDir(root, passId); branch = candidateBranch(passId); } catch { return; }
  await ok(git(['worktree', 'remove', '--force', '--force', dir], root));
  await ok(rm(dir, { recursive: true, force: true }));
  await ok(git(['worktree', 'prune'], root));
  await ok(git(['branch', '-D', '--quiet', branch], root));
}

/** Makes the verified candidate commit: exactly `tree` on top of `base`. Runs no hooks. */
export async function commitTree(repo: string, tree: string, parent: string, message: string, deps: GitDeps = {}): Promise<string> {
  const git = safeGit(deps.git ?? runGit);
  return (await git(['commit-tree', '--no-gpg-sign', tree, '-p', parent, '-F', '-'], resolve(repo), { input: message.endsWith('\n') ? message : `${message}\n` })).trim();
}

export type SquashResult = { ok: true; commit: string } | { ok: false; error: string };
/** The commit and tree that passed every check (from runCandidate). */
export type Verified = { commit: string; tree: string };

/**
 * Squashes the verified candidate onto refs/hal/main as one commit with `message`: `commit-tree` of exactly
 * `verified.tree` with the recorded pre-merge HEAD as its only parent (no merge machinery, no hooks). Refuses unless
 * `verified.commit` has that tree and sits directly on the pre-merge HEAD (main moved since the candidate branched),
 * checks the new commit's tree, then moves refs/hal/main by CAS from the recorded HEAD. Branch refs are never read, so
 * moving hal/<pass> after verification changes nothing. Then the main worktree is moved to the new commit. On any
 * failure, refs/hal/main and the main worktree stay at the pre-merge HEAD and `{ ok: false }` is returned.
 */
export async function squashMerge(repo: string, passId: string, message: string, verified: Verified, deps: GitDeps = {}): Promise<SquashResult> {
  const git = safeGit(deps.git ?? runGit);
  const root = resolve(repo);
  const dir = mainWorktreeDir(root);
  let pre: string;
  try {
    checkPass(passId);
    pre = await rev(git, 'HEAD', dir);
    const hal = await rev(git, HAL_MAIN, root);
    if (pre !== hal) return { ok: false, error: `main worktree is at ${pre}, not ${HAL_MAIN} (${hal}); run ensureMainWorktree first` };
    if ((await git(['status', '--porcelain', '--untracked-files=all'], dir)).trim() !== '') return { ok: false, error: 'main worktree is not clean' };
    const vTree = (await git(['rev-parse', `${verified.commit}^{tree}`], root)).trim();
    if (vTree !== verified.tree) return { ok: false, error: `verified commit's tree ${vTree} is not the verified tree ${verified.tree}` };
    const parents = (await git(['rev-list', '--parents', '-n', '1', verified.commit], root)).trim().split(' ').slice(1);
    if (parents.length !== 1 || parents[0] !== pre) return { ok: false, error: `the candidate does not sit on ${HAL_MAIN} (${pre}); main moved since it branched` };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
  try {
    const commit = await commitTree(root, verified.tree, pre, message, deps);
    if ((await git(['rev-parse', `${commit}^{tree}`], root)).trim() !== verified.tree) throw new Error('squash commit tree is not the verified tree');
    await git(['update-ref', '-m', `hal: squash ${passId}`, HAL_MAIN, commit, pre], root);
    // refs/hal/main has moved to a verified commit; a failure below only leaves Hal's worktree behind (ensureMainWorktree repairs it).
    await ok(git(['checkout', '--detach', '--force', '--quiet', commit], dir));
    return { ok: true, commit };
  } catch (e) {
    const error = errText(e);
    await ok(git(['reset', '--hard', '--quiet', pre], dir));
    await ok(git(['clean', '-fdq'], dir));
    return { ok: false, error };
  }
}

export type PushResult = { ok: true } | { ok: false; error: string };
/** Publishes refs/hal/main as origin's main, fast-forward only (no force). A rejection is `{ ok: false }`. */
export async function pushHalMain(repo: string, deps: GitDeps = {}): Promise<PushResult> {
  const git = deps.git ?? runGit; // Brian's own credentials and env: no scrubbing here
  try {
    await git(['push', '--quiet', '--porcelain', 'origin', `${HAL_MAIN}:refs/heads/main`], resolve(repo));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** The commit on refs/hal/main that merged `passId` (by its Hal-Pass trailer; undo commits are skipped), or null. Task 7 does the undo. */
export async function revertPass(repo: string, passId: string, deps: GitDeps = {}): Promise<string | null> {
  const git = safeGit(deps.git ?? runGit);
  const out = await git(['log', '--format=%H%x00%B%x1e', HAL_MAIN], resolve(repo));
  for (const rec of out.split('\x1e')) {
    const i = rec.indexOf('\0');
    if (i < 0) continue;
    const t = parseTrailers(rec.slice(i + 1));
    if (t && t.pass === passId && t.undo === undefined) return rec.slice(0, i).trim();
  }
  return null;
}

// ---- candidate trees ------------------------------------------------------
//
// Hal never trusts a worktree's index (assume-unchanged, skip-worktree, fsmonitor) or its filters (clean/smudge, eol):
// the candidate is hashed from the bytes on disk into a private index with `hash-object --no-filters`, and the tripwires,
// the release edits and the commit all work on that tree object.

/** `tmpRoot`: where Hal's private index files go (default os.tmpdir()); runCandidate uses a dir the checks cannot write. */
export type TreeDeps = { git?: GitRunner; tmpRoot?: string };
const privateTmp = async (root: string | undefined, prefix: string) => { const r = root ?? tmpdir(); await mkdir(r, { recursive: true }); return mkdtemp(join(r, prefix)); };
type TreeEntry = { mode: string; sha: string };

/** `ls-tree -r` of a tree-ish as path -> {mode, sha}. */
async function lsTree(git: GitRunner, treeish: string, cwd: string): Promise<Map<string, TreeEntry>> {
  const out = await git(['ls-tree', '-r', '-z', '--full-tree', treeish], cwd);
  const m = new Map<string, TreeEntry>();
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, , sha] = rec.slice(0, tab).split(' ');
    m.set(rec.slice(tab + 1), { mode: mode!, sha: sha! });
  }
  return m;
}

/** Walks `dir` (not following symlinks), skipping the top-level .git and node_modules. Repo-relative posix paths of every non-directory. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const go = async (rel: string) => {
    for (const ent of await readdir(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${ent.name}` : ent.name;
      if (!rel && (ent.name === '.git' || ent.name === 'node_modules')) continue;
      if (ent.isDirectory()) await go(p);
      else out.push(p);
    }
  };
  await go('');
  return out;
}

/** Hashes the given worktree paths from disk (no filters) into entries; symlinks become mode 120000 blobs of their target. */
async function hashPaths(git: GitRunner, dir: string, paths: string[]): Promise<Map<string, TreeEntry>> {
  const out = new Map<string, TreeEntry>();
  const files: { p: string; mode: string }[] = [];
  for (const p of paths) {
    if (/[\n\r\0]/.test(p)) throw new Error(`candidate path has a control character: ${JSON.stringify(p)}`);
    const st = await lstat(join(dir, p));
    if (st.isSymbolicLink()) {
      const sha = (await git(['hash-object', '-w', '--no-filters', '--stdin'], dir, { input: await readlink(join(dir, p)) })).trim();
      out.set(p, { mode: '120000', sha });
    } else if (st.isFile()) files.push({ p, mode: st.mode & 0o100 ? '100755' : '100644' });
    else throw new Error(`candidate path is not a file or symlink: ${p}`);
  }
  if (files.length) {
    const shas = (await git(['hash-object', '-w', '--no-filters', '--stdin-paths'], dir, { input: files.map((f) => f.p).join('\n') + '\n' })).trim().split('\n');
    if (shas.length !== files.length) throw new Error('hash-object returned the wrong number of hashes');
    files.forEach((f, i) => out.set(f.p, { mode: f.mode, sha: shas[i]! }));
  }
  return out;
}

/** Writes `entries` into a fresh private index (optionally starting from `fromTree`) and returns the tree. */
async function writeTree(git: GitRunner, dir: string, entries: Map<string, TreeEntry>, fromTree: string | undefined, tmpRoot: string | undefined): Promise<string> {
  const tmp = await privateTmp(tmpRoot, 'hal-index-');
  const env = { GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    if (fromTree) await git(['read-tree', fromTree], dir, { env });
    else await git(['read-tree', '--empty'], dir, { env });
    const info = [...entries].map(([p, e]) => `${e.mode} ${e.sha}\t${p}\0`).join('');
    if (info) await git(['update-index', '-z', '--index-info'], dir, { env, input: info });
    return (await git(['write-tree'], dir, { env })).trim();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * The candidate tree, from the bytes on disk: every path tracked at `base` that still exists, plus every untracked path
 * that the ignore rules (.gitignore, info/exclude, core.excludesFile) do not exclude. With `prune`, every other file in
 * the worktree (ignored ones; not .git or node_modules) is deleted, so the disk holds exactly the tree the checks judge.
 */
export async function snapshotTree(dir: string, base: string, deps: TreeDeps & { prune?: boolean } = {}): Promise<string> {
  const git = safeGit(deps.git ?? runGit);
  if (deps.prune && !resolve(dir).includes(`${sep}.data${sep}hal${sep}wt${sep}`)) throw new Error(`snapshotTree: refusing to prune outside a Hal worktree: ${dir}`);
  const tracked = await lsTree(git, base, dir);
  const tmp = await privateTmp(deps.tmpRoot, 'hal-index-');
  let others: Set<string>;
  try {
    const env = { GIT_INDEX_FILE: join(tmp, 'index') };
    await git(['read-tree', base], dir, { env });
    others = new Set((await git(['ls-files', '--others', '--exclude-standard', '-z'], dir, { env })).split('\0').filter(Boolean));
  } finally { await rm(tmp, { recursive: true, force: true }); }
  const keep: string[] = [];
  for (const p of await walk(dir)) {
    if (tracked.has(p) || others.has(p)) keep.push(p);
    else if (deps.prune) await rm(join(dir, p), { force: true });
  }
  return writeTree(git, dir, await hashPaths(git, dir, keep), undefined, deps.tmpRoot);
}

/** `tree` with `paths` re-hashed from disk (no filters). Hal's own edits (release files, history images) go in this way. */
export async function extendTree(dir: string, tree: string, paths: string[], deps: TreeDeps = {}): Promise<string> {
  const git = safeGit(deps.git ?? runGit);
  return writeTree(git, dir, await hashPaths(git, dir, paths), tree, deps.tmpRoot);
}

/**
 * `tree` with `path` set to the bytes of `file`, a regular file outside the worktree (Hal's private dir), hashed straight
 * into the object store: it never passes through the worktree disk, so nothing planted there (a symlink) is followed.
 */
export async function addFileToTree(dir: string, tree: string, path: string, file: string, deps: TreeDeps = {}): Promise<string> {
  const git = safeGit(deps.git ?? runGit);
  const st = await lstat(file);
  if (!st.isFile()) throw new Error(`addFileToTree: not a regular file: ${file}`);
  const sha = (await git(['hash-object', '-w', '--no-filters', '--stdin'], dir, { input: await readFile(file) })).trim();
  return writeTree(git, dir, new Map([[path, { mode: '100644', sha }]]), tree, deps.tmpRoot);
}

/** Paths that differ between two tree-ish objects (no rename detection), sorted. */
export async function changedPaths(dir: string, a: string, b: string, deps: TreeDeps = {}): Promise<string[]> {
  const git = safeGit(deps.git ?? runGit);
  return (await git(['diff-tree', '-r', '-z', '--name-only', '--no-renames', a, b], dir)).split('\0').filter(Boolean).sort();
}

/** A blob's bytes at `treeish:path`, from the object store (SAFE_GIT, scrubbed env). */
export async function blobBytes(dir: string, treeish: string, path: string): Promise<Buffer> {
  return safeBytes(['cat-file', 'blob', `${treeish}:${path}`], dir);
}

/** A blob's text at `treeish:path`, from the object store. */
export async function blobText(dir: string, treeish: string, path: string, deps: TreeDeps = {}): Promise<string> {
  return safeGit(deps.git ?? runGit)(['cat-file', 'blob', `${treeish}:${path}`], dir);
}

/**
 * collectDiff over git objects: the Diff of `tree` against `base`, with contents from `git cat-file` (never the disk or
 * the index). Test counts come from `deps.countTests` run in `dir`, which must hold exactly `tree` (snapshotTree prune).
 * Fails closed like collectDiff: any unreadable object throws.
 */
export async function collectTreeDiff(dir: string, base: string, tree: string, deps: CollectDeps = {}): Promise<Diff> {
  const git = safeGit(deps.git ?? runGit);
  const root = resolve(dir);
  const [nameStatus, numstat] = await Promise.all([
    git(['diff-tree', '-r', '-z', '-M', '--name-status', '--no-ext-diff', '--no-textconv', base, tree], root),
    git(['diff-tree', '-r', '-z', '-M', '--numstat', '--no-ext-diff', '--no-textconv', base, tree], root),
  ]);
  const rows = parseNameStatus(nameStatus);
  const binaryPaths = parseBinary(numstat);
  const after = await lsTree(git, tree, root);
  const blob = (sha: string) => safeBytes(['cat-file', 'blob', sha], root);
  const files: FileChange[] = [];
  for (const r of rows) {
    if (r.path.split('/').includes('..') || r.path.startsWith('/')) throw new Error(`collectTreeDiff: bad path ${r.path}`);
    const isText = TEXT_EXT.has(extOf(r.path));
    let a: string | null = null, binary = !isText && binaryPaths.has(r.path), suspect = false, symlinked = false;
    if (r.status !== 'D') {
      const e = after.get(r.path);
      if (!e) throw new Error(`collectTreeDiff: ${r.path} missing from the tree`);
      if (e.mode === '120000') { symlinked = true; binary = false; a = (await blob(e.sha)).toString('utf8'); }
      else if (e.mode === '100644' || e.mode === '100755') { const d = decode(await blob(e.sha), isText, binary); a = d.after; binary = d.binary; suspect = d.suspect; }
      else throw new Error(`collectTreeDiff: not a regular file or symlink: ${r.path} (mode ${e.mode})`);
    }
    let before: string | null = null;
    if (r.status !== 'A' && !binary) before = await git(['cat-file', 'blob', `${base}:${r.oldPath ?? r.path}`], root);
    files.push({ path: r.path, status: r.status, before, after: a, binary, ...(r.oldPath !== undefined ? { oldPath: r.oldPath } : {}), ...(symlinked ? { symlink: true } : {}), ...(suspect ? { suspectEncoding: true } : {}) });
  }
  const baseTree = await lsTree(git, base, root);
  const text = async (m: Map<string, TreeEntry>, f: string) => { const e = m.get(f); return e && e.mode !== '120000' ? (await blob(e.sha)).toString('utf8') : null; };
  const beforeTexts = new Map<string, string | null>(), afterTexts = new Map<string, string | null>();
  for (const s of LEVEL_SOURCES) { beforeTexts.set(s.file, await text(baseTree, s.file)); afterTexts.set(s.file, await text(after, s.file)); }
  const tests = await (deps.countTests ?? vitestCounts)(root, base);
  return {
    files,
    testCountBefore: tests.before,
    testCountAfter: tests.after,
    ...(tests.beforeByFile && tests.afterByFile ? { testCountsByFile: { before: tests.beforeByFile, after: tests.afterByFile } } : {}),
    levelCounts: { before: levelCounts((f) => beforeTexts.get(f) ?? null), after: levelCounts((f) => afterTexts.get(f) ?? null) },
    repoFiles: [...after.keys()],
  };
}
