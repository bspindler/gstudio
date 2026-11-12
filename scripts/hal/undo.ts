// Undo of one merged pass, in Hal's main worktree, onto refs/hal/main. Used by `hal undo` and by the run's preflight
// (pending undos), always under the run lock (the caller holds it). Nothing moves unless every step passes:
//   1. revertPass finds the pass's squash commit on refs/hal/main
//   2. `git revert --no-commit` in the main worktree; conflicts only in that game's version files or history images are
//      resolved to HEAD (they are rewritten in step 3); any other conflict fails the undo
//   3. CHANGELOG.md and the history images are kept as they are at HEAD; undoEntry writes a NEW patch version and an
//      `Undone: <title> (<pass>): <reason>` bullet (versions never go backwards)
//   4. npm test (package.json's script, Hal's tools), each step isolated and sandboxed like a candidate's checks, with
//      node_modules relinked and verified and the tree required unchanged before each step and after the last
//   5. commit-tree of that exact tree (trailers incl. Hal-Undo, Hal-Reason) and a compare-and-swap of refs/hal/main
// On any failure the main worktree is reset to refs/hal/main, which has not moved.
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatTrailers, nightOf, parseTrailers, undoEntry } from '@studio/core/hal';
import { blobText, commitTree, HAL_MAIN, mainWorktreeDir, revertPass, runGit, safeGit, snapshotTree, type GitRunner } from './git.js';
import { defaultCommands, resolveTools } from './candidate.js';
import { assertNoRepoFilters, dotGit, errMsg, isolatedCheck, redactor, scriptsOf, tail } from './run-util.js';
import { sandboxAvailable } from './sandbox.js';

export const UNDO_TEST_TIMEOUT_MS = 20 * 60_000;
export type UndoCtx = {
  repo: string;
  /** Run id for the Hal-Run trailer of the undo commit. */
  runId: string;
  now: () => Date;
  tzOffsetMinutes?: number;
  secrets: readonly string[];
  git?: GitRunner;
  /** The test run in the main worktree, as a sequence of argv that must all exit 0; default package.json's `test`
   *  script with Hal's tools from <repo>/node_modules (defaultCommands). Always isolated, each step guarded. */
  testCommand?: (dir: string) => string[][];
  timeoutMs?: number;
  /** TESTS ONLY. */
  unsandboxedForTests?: boolean;
};
export type UndoResult = { ok: true; commit: string; version: string; game: string; already?: boolean } | { ok: false; error: string; permanent?: boolean };

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const PASS_RE = /^HAL-\d+$/;

/** The commit on refs/hal/main that already undid `pass` (Hal-Undo trailer), or null. */
async function findUndo(git: GitRunner, repo: string, pass: string): Promise<string | null> {
  const out = await git(['log', '--format=%H%x00%B%x1e', HAL_MAIN], repo);
  for (const rec of out.split('\x1e')) {
    const i = rec.indexOf('\0');
    if (i < 0) continue;
    if (parseTrailers(rec.slice(i + 1))?.undo === pass) return rec.slice(0, i).trim();
  }
  return null;
}

/** Reverts one merged pass onto refs/hal/main. Never throws; `{ ok: false }` leaves refs/hal/main and the worktree as they were. */
export async function applyUndo(pass: string, reason: string, ctx: UndoCtx): Promise<UndoResult> {
  const raw = ctx.git ?? runGit;
  const git = safeGit(raw);
  const { str: redact } = redactor(ctx.secrets);
  const repo = ctx.repo;
  const dir = mainWorktreeDir(repo);
  const why = oneLine(redact(reason));
  if (!PASS_RE.test(pass)) return { ok: false, error: `bad pass id ${JSON.stringify(pass)}`, permanent: true };
  if (!why) return { ok: false, error: 'an undo needs a reason', permanent: true };
  let head: string;
  try {
    head = (await git(['rev-parse', '--verify', `${HAL_MAIN}^{commit}`], repo)).trim();
    if ((await git(['rev-parse', 'HEAD'], dir)).trim() !== head) return { ok: false, error: `main worktree is not at ${HAL_MAIN}` };
    if ((await git(['status', '--porcelain', '--untracked-files=all'], dir)).trim() !== '') return { ok: false, error: 'main worktree is not clean' };
    await assertNoRepoFilters(repo, dir, git);
  } catch (e) { return { ok: false, error: redact(errMsg(e)) }; }

  let touched = false;
  const gitPtr = dotGit(dir); // the worktree's gitdir pointer: a check that rewrote it would aim Hal's git at its own config
  /** Puts .git back if a check changed it (`tampered`), then `filter` is set if this tree's config could run a filter. */
  const safeHere = async (): Promise<{ tampered: boolean; filter: string | null }> => {
    const tampered = dotGit(dir) !== gitPtr;
    if (tampered) writeFileSync(join(dir, '.git'), gitPtr);
    try { await assertNoRepoFilters(repo, dir, git); return { tampered, filter: null }; } catch (e) { return { tampered, filter: errMsg(e) }; }
  };
  const TAMPERED = "the main worktree's .git changed during the tests (restored)";
  const fail = async (error: string): Promise<UndoResult> => {
    if (touched) {
      const h = await safeHere();
      if (h.tampered && !error.includes(TAMPERED)) error = `${error}; ${TAMPERED}`;
      // Fail closed: no git at all in a tree whose config could run a program. ensureMainWorktree refuses too.
      if (h.filter) return { ok: false, error: redact(tail(`${error}; ${h.filter}; the main worktree was left as it is`, 2000)) };
      for (const a of [['revert', '--quit'], ['reset', '--hard', '--quiet', head], ['clean', '-fdq']]) await git(a, dir).catch(() => {});
    }
    return { ok: false, error: redact(tail(error, 2000)) };
  };
  try {
    const sha = await revertPass(repo, pass, { git: raw });
    if (!sha) return { ok: false, error: `no merged commit for ${pass} on ${HAL_MAIN}`, permanent: true };
    const done = await findUndo(git, repo, pass);
    const t = parseTrailers(await git(['log', '-1', '--format=%B', sha], repo))!;
    if (done) return { ok: true, commit: done, version: t.version, game: t.game, already: true };
    const game = t.game;
    const title = (await git(['log', '-1', '--format=%s', sha], repo)).trim().replace(/^[a-z]+\([^)]*\):\s*/, '');
    // Fail closed before touching anything: the tests must be able to run sandboxed.
    if (ctx.unsandboxedForTests !== true && !sandboxAvailable()) return fail('no sandbox: refusing to run npm test unsandboxed');

    const files = { yaml: `games/${game}/game.yaml`, html: `games/${game}/index.html`, changelog: `games/${game}/CHANGELOG.md` };
    const history = `docs/hal/history/`;
    const resolvable = (p: string) => p === files.yaml || p === files.html || p === files.changelog || p.startsWith(history);
    touched = true;
    try {
      await git(['revert', '--no-commit', '--no-edit', sha], dir);
    } catch (e) {
      const conflicted = (await git(['diff', '--name-only', '--diff-filter=U'], dir)).split('\n').filter(Boolean);
      const hard = conflicted.filter((p) => !resolvable(p));
      if (conflicted.length === 0 || hard.length) return fail(`revert conflicts${hard.length ? ` in ${hard.join(', ')}` : `: ${errMsg(e)}`}`);
      // Only Hal's own release files / pictures conflicted: they are rewritten from HEAD below.
      for (const p of conflicted) await git(['checkout', head, '--', p], dir);
    }
    // Keep the changelog's history and the pictures (the record of what was tried) as they are at HEAD.
    await git(['checkout', head, '--', files.changelog], dir);
    const hist = (await git(['ls-tree', '-r', '--name-only', head, '--', history], repo)).split('\n').filter(Boolean);
    if (hist.length) await git(['checkout', head, '--', history], dir);
    const current = /^version:[ \t]*(\S+)[ \t]*$/m.exec(await blobText(repo, head, files.yaml, { git: raw }))?.[1];
    if (!current) return fail(`${files.yaml} has no version at ${HAL_MAIN}`);
    const cur = {
      yaml: await readFile(join(dir, files.yaml), 'utf8'),
      html: await readFile(join(dir, files.html), 'utf8'),
      changelog: await readFile(join(dir, files.changelog), 'utf8'),
    };
    const night = nightOf(ctx.now(), ctx.tzOffsetMinutes ?? -ctx.now().getTimezoneOffset());
    let next: typeof cur;
    try { next = undoEntry(cur, { slug: game, current, night, title, pass, reason: why }); } catch (e) { return fail(`release failed: ${errMsg(e)}`); }
    for (const k of ['yaml', 'html', 'changelog'] as const) await writeFile(join(dir, files[k]), next[k]);
    const version = /^version:[ \t]*(\S+)/m.exec(next.yaml)![1]!;

    const tmpRoot = join(repo, '.data', 'hal', 'tmp', 'undo'); // Hal's private index files: not writable by the checks
    await rm(tmpRoot, { recursive: true, force: true });
    await mkdir(tmpRoot, { recursive: true });
    const snap = () => snapshotTree(dir, head, { git: raw, tmpRoot });
    const tree = await snap();
    const headTree = (await git(['rev-parse', `${head}^{tree}`], repo)).trim();
    if (tree === headTree) return fail('the revert changed nothing');

    let steps: string[][];
    try {
      steps = ctx.testCommand ? ctx.testCommand(dir) : defaultCommands(resolveTools(repo), scriptsOf(await blobText(repo, head, 'package.json', { git: raw }))).test(dir);
    } catch (e) { return fail(`npm test: ${errMsg(e)}`); }
    for (const argv of steps) {
      if ((await snap()) !== tree) return fail('the worktree changed while the tests ran');
      const r = await isolatedCheck(argv, {
        cwd: dir, repo, secrets: ctx.secrets, writable: [dir], timeoutMs: ctx.timeoutMs ?? UNDO_TEST_TIMEOUT_MS,
        ...(ctx.unsandboxedForTests ? { unsandboxedForTests: true } : {}),
      });
      if (r.error === 'no sandbox') return fail('no sandbox: refusing to run npm test unsandboxed');
      const h = await safeHere();
      if (h.tampered) return fail(TAMPERED);
      if (h.filter) return fail(h.filter);
      if (r.code !== 0) return fail(`npm test failed${r.timedOut ? ' (timed out)' : r.error ? ` to run: ${r.error}` : ''}:\n${tail(`${r.stdout}\n${r.stderr}`)}`);
    }
    if ((await snap()) !== tree) return fail('the worktree changed while the tests ran');
    await rm(tmpRoot, { recursive: true, force: true });

    const trailers = formatTrailers({
      pass, game, kind: 'fix', why, scoreBefore: t.scoreAfter, scoreAfter: t.scoreBefore, version, run: ctx.runId, undo: pass, reason: why,
    });
    const message = `revert(${game}): undo ${oneLine(title)}\n\nUndoes ${pass}: ${why}\n\n${trailers}`;
    if (ctx.secrets.some((k) => k && message.includes(k))) return fail('undo commit message contains a secret');
    const commit = await commitTree(repo, tree, head, message, { git: raw });
    if ((await git(['rev-parse', `${commit}^{tree}`], repo)).trim() !== tree) return fail('undo commit tree is not the tested tree');
    await git(['update-ref', '-m', `hal: undo ${pass}`, HAL_MAIN, commit, head], repo); // CAS: fails if refs/hal/main moved
    touched = false; // refs/hal/main now holds the tested commit; from here only the worktree follows it
    await git(['revert', '--quit'], dir).catch(() => {});
    await git(['checkout', '--detach', '--force', '--quiet', commit], dir);
    return { ok: true, commit, version, game };
  } catch (e) {
    return fail(errMsg(e));
  }
}
