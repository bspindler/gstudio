// Read-only git history for the implementer (docs/hal/plans/2026-11-15-permission-split.md, part C), and its check of
// a "Hal asks" patch. Run as `npm run hal -- git <log|show|diff|blame> ...` and `npm run hal -- asks check --game <g>`,
// inside the implementer's sandboxed Bash (claude.ts roleAllowedTools).
//
// Layers, outermost first:
//   1. Claude Code's sandbox (claude.ts implementerSandboxSettings) is the hard boundary: writes only in the worktree,
//      its temp dir and the score broker's dir, no network. The worktree's gitdir and the shared .git live under
//      <repo>/.git, outside every writable path, so no git command, whatever its flags, can move a ref, write an object,
//      the index or config there. Reads are allowed (the sandbox denies reads only for .hal.env and home secrets).
//   2. Claude Code's permission rules pre-approve only `npm run hal -- git:*` and `npm run hal -- asks check:*`: bare
//      `git` (or anything else) is refused in a -p run.
//   3. This file: only log/show/diff/blame, only allowlisted options (exact names: git's long-option abbreviations
//      like --outp for --output never match), no absolute or `..` paths (git diff would read outside the repo), and git
//      runs with no pager, hooks, fsmonitor, external diff, textconv, signature checks or protocols, an env without
//      GIT_* overrides, system or global config, and no optional locks (so `git diff` never refreshes the index).
// The worktree is the implementer's own checkout, so whatever it could read here it could Read anyway; history is new.
import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASKS_FILE, ASKS_MAX_BYTES, checkAsksPatchText } from '@studio/core/hal';

export const GIT_READ_SUBCOMMANDS = ['log', 'show', 'diff', 'blame'] as const;
type Sub = (typeof GIT_READ_SUBCOMMANDS)[number];

/** `-c` pairs put before the subcommand: nothing git runs on its own (pager, hooks, fsmonitor, ext diff, gpg, transports). */
export const GIT_READ_CONFIG: string[] = [
  'core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.pager=cat', 'core.untrackedCache=false', 'diff.external=',
  'protocol.allow=never', 'core.sshCommand=false', 'credential.helper=', 'log.showSignature=false', 'gpg.program=false',
  'gc.auto=0', 'maintenance.auto=false',
].flatMap((kv) => ['-c', kv]);

// Options shared by log, show and diff (exact names). Each either takes no value, or an optional/required `=value`
// (a separate value word is a plain argument, which is allowed anyway).
const DIFF_LOG_FLAGS = new Set([
  '--oneline', '--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--patch', '--no-patch', '--raw', '--decorate', '--no-decorate',
  '--graph', '--all', '--reverse', '--first-parent', '--no-merges', '--merges', '--follow', '--abbrev-commit', '--no-abbrev-commit', '--ignore-all-space',
  '--ignore-space-change', '--ignore-blank-lines', '--ignore-space-at-eol', '--summary', '--full-history', '--cc', '--minimal', '--patience', '--histogram',
  '--function-context', '--left-right', '--cherry-pick', '--cherry-mark', '--boundary', '--topo-order', '--date-order', '--author-date-order', '--no-renames',
  '--find-renames', '--find-copies', '--compact-summary', '--dirstat', '--no-color', '--color', '--word-diff', '--color-words', '--pickaxe-all', '--pickaxe-regex',
  '--regexp-ignore-case', '--all-match', '--invert-grep', '--branches', '--tags', '--remotes', '--source', '--relative', '--text', '--exit-code', '--quiet',
  '--no-prefix', '--full-index', '--cached', '--staged', '--merge-base', '--no-ext-diff', '--no-textconv', '--parents', '--children', '--simplify-by-decoration',
  '--ancestry-path', '--dense', '--sparse', '--max-count', '--skip', '--since', '--after', '--until', '--before', '--author', '--committer', '--grep',
  '--format', '--pretty', '--date', '--unified', '--abbrev', '--diff-filter', '--inter-hunk-context', '--encoding', '--word-diff-regex', '--max-parents',
  '--min-parents', '--stat-width', '--stat-count', '--diff-algorithm', '--anchored', '--fixed-strings', '--basic-regexp', '--extended-regexp', '--perl-regexp',
  '--no-walk', '--do-walk', '--show-pulls', '--remerge-diff', '--diff-merges', '--no-diff-merges', '--irreversible-delete', '--patch-with-stat', '--patch-with-raw',
  '--name-rev', '--notes', '--no-notes', '--log-size', '--expand-tabs', '--no-expand-tabs', '--use-mailmap', '--no-use-mailmap', '--mailmap', '--no-mailmap',
]);
const DIFF_LOG_SHORT = new Set(['-p', '-u', '-s', '-w', '-b', '-m', '-M', '-C', '-W', '-i', '-a', '-R', '-z', '-t', '-r', '-E', '-F', '-P', '-B', '-D']);
const BLAME_FLAGS = new Set([
  '--porcelain', '--line-porcelain', '--root', '--show-stats', '--reverse', '--first-parent', '--show-name', '--show-number', '--show-email', '--incremental',
  '--minimal', '--abbrev', '--date', '--color-lines', '--color-by-age', '--ignore-rev', '--no-progress', '--score-debug', '--encoding', '--since',
]);
const BLAME_SHORT = new Set(['-w', '-M', '-C', '-e', '-s', '-l', '-t', '-f', '-n', '-p', '-b', '-r']);
/** Short options that take a value, attached (`-n5`, `-Sfoo`, `-L1,9:f`) or as the next word. */
const VALUE_SHORT: Record<Sub, string> = { log: 'nUMCSGL', show: 'nUMCSGL', diff: 'UMCSG', blame: 'LMC' };

const optionName = (a: string) => (a.startsWith('--') ? a.split('=', 1)[0]! : a);

/** The full git argv for a read-only history command, or why it is refused. */
export function gitReadArgv(args: string[]): { argv: string[] } | { error: string } {
  const [sub, ...rest] = args;
  if (!GIT_READ_SUBCOMMANDS.includes(sub as Sub)) {
    return { error: `refused: only ${GIT_READ_SUBCOMMANDS.map((s) => `git ${s}`).join(', ')} are allowed here (read-only history); the subcommand comes first, with no git options before it` };
  }
  const s = sub as Sub;
  const flags = s === 'blame' ? BLAME_FLAGS : DIFF_LOG_FLAGS;
  const short = s === 'blame' ? BLAME_SHORT : DIFF_LOG_SHORT;
  let paths = false;
  for (const a of rest) {
    if (a.length > 4096) return { error: 'refused: argument too long' };
    if (/%G/.test(a)) return { error: `refused: ${a}: signature placeholders run gpg` };
    if (paths || !a.startsWith('-')) {
      // A revision, a range or a path. A path on disk outside the worktree is refused (git diff with two paths outside
      // the repo turns into --no-index); `rev:path` names a path inside a tree object and is fine.
      const disk = paths || !/^[^:]*:/.test(a) ? a : '';
      if (disk.startsWith('/') || disk.startsWith('~') || disk.split('/').includes('..')) return { error: `refused: ${JSON.stringify(a)} is outside the worktree` };
      continue;
    }
    if (a === '--') { paths = true; continue; }
    const name = optionName(a);
    if (a.startsWith('--')) {
      if (flags.has(name)) continue;
      return { error: `refused: ${name} is not allowed here (read-only history: no --output, external diff, textconv, signatures, pagers or files)` };
    }
    if (/^-\d+$/.test(a) && s !== 'blame') continue; // -5
    if (short.has(a)) continue;
    const letter = a.slice(1, 2);
    if (a.length > 2 && VALUE_SHORT[s].includes(letter) && !/[\0\n]/.test(a)) continue; // attached value
    if (a.length === 2 && VALUE_SHORT[s].includes(letter)) continue; // value in the next word
    return { error: `refused: ${a} is not allowed here (read-only history; combine no short options, and -c, -o and -O are never allowed)` };
  }
  const safety = s === 'blame' ? ['--no-textconv'] : ['--no-ext-diff', '--no-textconv'];
  return { argv: ['--no-pager', ...GIT_READ_CONFIG, s, ...safety, ...rest] };
}

/** `base` without GIT_* overrides or credentials; no system/global config, optional locks, prompts, lazy fetches or pager. */
export function gitReadEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^GIT_/.test(k) || /^(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|HAL_TOKEN)$/.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_PAGER: 'cat', PAGER: 'cat',
  };
}

export type Io = { stdout: (s: string) => void; stderr: (s: string) => void };
const consoleIo: Io = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) };
const GIT_READ_TIMEOUT_MS = 60_000;

function runGitArgv(argv: string[], cwd: string, io: Io, input?: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn('git', argv, { cwd, env: gitReadEnv(), stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_READ_TIMEOUT_MS);
    child.stdout!.on('data', (d: Buffer) => io.stdout(d.toString('utf8')));
    child.stderr!.on('data', (d: Buffer) => io.stderr(d.toString('utf8')));
    child.on('error', (e) => { clearTimeout(timer); io.stderr(`${e.message}\n`); done(1); });
    child.on('close', (code) => { clearTimeout(timer); done(code ?? 1); });
    if (input !== undefined) { child.stdin!.on('error', () => {}); child.stdin!.end(input); }
  });
}

/** Runs one read-only history command in `cwd`; 2 = refused (git never ran), else git's exit code. */
export async function runGitRead(args: string[], cwd: string, io: Io = consoleIo): Promise<number> {
  const r = gitReadArgv(args);
  if ('error' in r) { io.stderr(`${r.error}\n`); return 2; }
  return runGitArgv(r.argv, cwd, io);
}

/**
 * `npm run hal -- asks check --game <g>`: the implementer's dry run of its hal-asks.patch. The same path and format
 * rules Hal applies (checkAsksPatchText), then `git apply --check --recount` against the worktree as it is (writes
 * nothing). Hal still re-checks everything itself after the build: this only saves a wasted build.
 */
export async function asksCheck(cwd: string, game: string, io: Io = consoleIo): Promise<number> {
  const file = join(cwd, ASKS_FILE);
  const st = await lstat(file).catch(() => null);
  if (!st) { io.stderr(`no ${ASKS_FILE} at the worktree root: write your proposed protected change there as a git-format unified diff\n`); return 1; }
  if (!st.isFile()) { io.stderr(`${ASKS_FILE} must be a regular file (not a symlink or folder)\n`); return 1; }
  if (st.size > ASKS_MAX_BYTES) { io.stderr(`${ASKS_FILE} is ${st.size} bytes; the cap is ${ASKS_MAX_BYTES}\n`); return 1; }
  const patch = await readFile(file, 'utf8');
  const refusals = checkAsksPatchText(patch, { game });
  if (refusals.length) { io.stderr(`${ASKS_FILE} is refused:\n${refusals.map((r) => `- ${r}`).join('\n')}\n`); return 1; }
  let err = '';
  const code = await runGitArgv(['--no-pager', ...GIT_READ_CONFIG, 'apply', '--check', '--recount', '--whitespace=nowarn', '-p1', '-'], cwd, { stdout: io.stdout, stderr: (s) => { err += s; } }, patch);
  if (code !== 0) { io.stderr(`${ASKS_FILE} does not apply to the worktree:\n${err}`); return 1; }
  io.stdout(`${ASKS_FILE} applies cleanly and touches only judge files. Hal re-checks it after the build and holds the result for Brian.\n`);
  return 0;
}
