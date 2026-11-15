// "Hal asks" (docs/hal/plans/2026-11-15-permission-split.md, part B): when a build needs a judge file changed (a
// protected test that pins a level count, a hook block that lists the tap targets), the implementer writes the change
// it needs as a unified diff in ASKS_FILE instead of giving up. Hal applies it next to the game change in a held
// candidate that only Brian can ship. This file decides what such a patch may touch. Pure: no fs, no git.
//
// Two checks, both fail closed:
//   checkAsksPatchText  the raw patch text, before git sees it: size, secrets, the git-format file sections and the
//                       paths they name (early, readable refusals)
//   checkAsksChanges    what applying it did to the tree (from git, authoritative): only judge files, added or modified,
//                       regular files, and a hook file changed inside its block only
import { HOOK_FILES, hookOnlyChange, isProtectedPath, SECRET_RE } from './tripwires.js';

/** The implementer writes its proposed protected change here, at the worktree root (Hal reads it and removes it). */
export const ASKS_FILE = 'hal-asks.patch';
/** The raw patch may be at most this many bytes. */
export const ASKS_MAX_BYTES = 32 * 1024;
/** And touch at most this many files. */
export const ASKS_MAX_FILES = 8;

/** What applying the patch changed, per path (git diff-tree --raw of the game tree against game + patch). */
export type AsksChange = {
  path: string;
  status: string;
  oldMode: string;
  newMode: string;
  before: string | null;
  after: string | null;
};

const lower = (p: string) => p.toLowerCase();

/**
 * Judge files Hal may still never ask to change: the code that enforces this boundary (tripwires, gate, this file, the
 * budget, the candidate pipeline, sandboxes, Claude's tool rules, git plumbing, the score broker and check channel, the
 * run, ship and report server) and Hal's own role prompts. A request may move a pinned content fact, never a rule.
 */
const GUARD_EXACT = new Set([
  'packages/core/src/hal/tripwires.ts', 'packages/core/src/hal/gate.ts', 'packages/core/src/hal/asks.ts', 'packages/core/src/hal/budget.ts',
  ...['candidate', 'claude', 'sandbox', 'git', 'git-read', 'env', 'score-broker', 'check-nonce', 'check-entry', 'run', 'run-util', 'cli-ops', 'cli-run', 'server', 'lock-live', 'undo', 'ci-sandboxed']
    .map((n) => `scripts/hal/${n}.ts`),
]);
const GUARD_PREFIXES = ['scripts/hal/prompts/'];
/** Config that decides which tests run or how they are typed (protected everywhere, refused even inside a judge folder). */
const CONFIG_BASENAME = /^(?:\.gitattributes|vitest\.workspace\.[^/]*|vitest\.config\.[^/]*|tsconfig[^/]*\.json)$/;
const POLICY_SHAPED = /^packages\/core\/src\/(?:.*\/)?(?:gateway|policy|compliance)[^/]*(?:\/|$)/;

/** A path git or the disk could read differently than it looks: refuse before any other check. */
function badPath(p: string): string | null {
  if (p === '') return 'empty path';
  if (/[\0-\x1f\x7f]/.test(p)) return 'control character in path';
  if (p.includes('\\')) return 'backslash in path';
  if (p.startsWith('/') || /^[a-z]:/i.test(p)) return 'absolute path';
  const parts = p.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) return 'path with an empty, . or .. segment';
  if (parts.some((x) => lower(x) === '.git')) return 'path inside .git';
  return null;
}

/**
 * Null when `path` is a judge file a request may change for a ticket on `game`, else the refusal. Judge files are
 * `scripts/hal/**`, `packages/core/src/hal/**`, `packages/core/test/hal-*.test.ts` and the ticket game's own hook file
 * (whose change is then held to its hook block by checkAsksChanges). Judge-folder prefixes match case-sensitively;
 * refusals match case-insensitively (macOS), so `Scripts/hal/x.ts` is not a judge file and `scripts/hal/Gate.ts`-style
 * spellings of a guard file are still refused.
 */
export function asksPathRefusal(path: string, game: string): string | null {
  const bad = badPath(path);
  if (bad) return `${JSON.stringify(path)}: ${bad}; refused`;
  const l = lower(path);
  const base = l.slice(l.lastIndexOf('/') + 1);
  if (CONFIG_BASENAME.test(base) || POLICY_SHAPED.test(l)) return `${path}: test config, gateway, policy or compliance code; refused`;
  if (GUARD_EXACT.has(l) || GUARD_PREFIXES.some((x) => l.startsWith(x))) return `${path}: Hal's own guard rails (tripwires, gate, budget, sandbox, pipeline, prompts) are never asked for; refused`;
  const judge = path.startsWith('scripts/hal/') || path.startsWith('packages/core/src/hal/') || /^packages\/core\/test\/hal-[^/]*\.test\.ts$/.test(path)
    || (HOOK_FILES.includes(path) && path === `games/${game}/index.html`);
  if (judge) return null;
  return isProtectedPath(path)
    ? `${path}: protected but not a judge file (policy, markets, CLAUDE.md, compliance, gateway, .hal.env, .data, infra, .github, vendor, package files, config and locked assets are never asked for); refused`
    : `${path}: not a judge file (game changes belong in the game change itself, not in the patch); refused`;
}

const FORBIDDEN_HEADERS: Array<[RegExp, string]> = [
  [/^GIT binary patch$/, 'binary patch'],
  [/^Binary files /, 'binary patch'],
  [/^(?:rename|copy) (?:from|to) /, 'rename or copy'],
  [/^(?:dis)?similarity index /, 'rename or copy'],
  [/^deleted file mode /, 'deletes a file'],
  [/^(?:old|new) mode /, 'mode change'],
];
const REGULAR = /^100(?:644|755)$/;

/**
 * Refusals for the raw patch text (empty = it may go on to git). Only git-format patches: every file section starts
 * with `diff --git a/<p> b/<p>` (same path on both sides), its headers come before its first hunk, and a `---`, `+++`
 * or `@@` line outside a section is refused (git would apply a bare one too). Messages never echo a secret.
 */
export function checkAsksPatchText(patch: string, opts: { game: string; secrets?: string[] }): string[] {
  const out: string[] = [];
  if (patch.trim() === '') return ['empty patch'];
  const bytes = new TextEncoder().encode(patch).length;
  if (bytes > ASKS_MAX_BYTES) out.push(`patch is ${bytes} bytes; the cap is ${ASKS_MAX_BYTES}`);
  if (patch.includes('\0')) out.push('patch has a NUL byte');
  const secrets = (opts.secrets ?? []).filter((s) => s.length >= 6);
  if (SECRET_RE.test(patch) || secrets.some((s) => patch.includes(s))) out.push('patch contains a secret value');
  if (out.length) return out;

  const paths = new Set<string>();
  const note = (p: string) => { paths.add(p); };
  let state: 'pre' | 'header' | 'hunk' = 'pre';
  let section = '';
  const lines = patch.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const at = `line ${i + 1}`;
    const git = /^diff --git (.*)$/.exec(line);
    if (git) {
      state = 'header';
      const rest = git[1]!;
      if (rest.includes('"')) { out.push(`${at}: quoted path in diff --git; refused`); section = ''; return; }
      const m = /^a\/(.+) b\/(.+)$/.exec(rest);
      if (!m || m[1] !== m[2]) { out.push(`${at}: diff --git paths differ or are not a/<path> b/<path> (no renames or copies)`); section = ''; return; }
      section = m[2]!;
      note(section);
      return;
    }
    if (state === 'pre') {
      if (/^(?:---|\+\+\+|@@) /.test(line) || line === '---' || line === '+++') out.push(`${at}: a patch header outside a diff --git section; refused`);
      return;
    }
    if (state === 'header') {
      for (const [re, what] of FORBIDDEN_HEADERS) if (re.test(line)) out.push(`${section || at}: ${what}; refused`);
      const nf = /^new file mode (\d+)$/.exec(line);
      if (nf && !REGULAR.test(nf[1]!)) out.push(`${section}: mode ${nf[1]} (not a regular file); refused`);
      const idx = /^index [0-9a-f]+\.\.[0-9a-f]+(?: (\d+))?$/.exec(line);
      if (idx?.[1] && !REGULAR.test(idx[1])) out.push(`${section}: mode ${idx[1]} (not a regular file); refused`);
      const minus = /^--- (.*)$/.exec(line);
      if (minus) {
        const v = minus[1]!;
        if (v.startsWith('"')) out.push(`${at}: quoted path; refused`);
        else if (v !== '/dev/null' && v !== `a/${section}`) out.push(`${at}: --- ${JSON.stringify(v.slice(0, 120))} does not match its diff --git path`);
        if (v !== '/dev/null' && v.startsWith('a/')) note(v.slice(2));
      }
      const plus = /^\+\+\+ (.*)$/.exec(line);
      if (plus) {
        const v = plus[1]!;
        if (v === '/dev/null') out.push(`${section}: deletes a file; refused`);
        else if (v.startsWith('"')) out.push(`${at}: quoted path; refused`);
        else {
          if (v !== `b/${section}`) out.push(`${at}: +++ ${JSON.stringify(v.slice(0, 120))} does not match its diff --git path`);
          if (v.startsWith('b/')) note(v.slice(2));
        }
      }
      if (line.startsWith('@@')) state = 'hunk';
      return;
    }
    // In a hunk: context, removed, added, "\ No newline", the next hunk; a blank line at the very end is fine.
    if (/^[ +\-\\]/.test(line) || line.startsWith('@@') || (line === '' && i === lines.length - 1)) return;
    if (line === '') return; // git apply treats an empty line in a hunk as empty context
    out.push(`${section}: ${at} is not part of a hunk; refused`);
    state = 'pre';
  });
  if (paths.size === 0) return [...out, 'patch names no file (it must be a git-format diff: diff --git a/<path> b/<path>, ---, +++, @@ hunks)'];
  if (paths.size > ASKS_MAX_FILES) out.push(`patch touches ${paths.size} files; the cap is ${ASKS_MAX_FILES}`);
  for (const p of paths) { const r = asksPathRefusal(p, opts.game); if (r) out.push(r); }
  return [...new Set(out)];
}

/** Refusals for what the applied patch changed (empty = allowed). `changes` comes from git, never from the patch text. */
export function checkAsksChanges(changes: AsksChange[], game: string): string[] {
  if (changes.length === 0) return ['patch changes nothing'];
  const out: string[] = [];
  if (changes.length > ASKS_MAX_FILES) out.push(`patch changes ${changes.length} files; the cap is ${ASKS_MAX_FILES}`);
  for (const c of changes) {
    const r = asksPathRefusal(c.path, game);
    if (r) { out.push(r); continue; }
    if (c.status !== 'A' && c.status !== 'M') { out.push(`${c.path}: ${c.status === 'D' ? 'deletes a file' : `status ${c.status}`}; refused`); continue; }
    if (!REGULAR.test(c.newMode)) { out.push(`${c.path}: mode ${c.newMode} (not a regular file); refused`); continue; }
    if (c.status === 'M' && c.oldMode !== c.newMode) { out.push(`${c.path}: mode change ${c.oldMode} -> ${c.newMode}; refused`); continue; }
    if (HOOK_FILES.includes(c.path) && !hookOnlyChange(c.before, c.after)) {
      out.push(`${c.path}: the patch changes it outside its hal hook block, or the hal hook block is not exactly one intact block; refused`);
    }
  }
  return out;
}
