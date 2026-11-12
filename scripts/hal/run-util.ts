// Small helpers shared by the run (run.ts) and undo (undo.ts): secret redaction for everything written under .data,
// the isolated (sandboxed) check runner for Hal's own checks outside a candidate, and lenient JSON extraction.
import { tmpdir } from 'node:os';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { NONCE_ENV, parseResult } from './candidate.js';
import { linkNodeModules, verifyNodeModules, type GitRunner } from './git.js';
import { runIsolated, sandboxAvailable, sandboxEnv, type IsolatedResult } from './sandbox.js';

export const REDACTED = '[REDACTED]';

export type Redactor = {
  /** The string with every secret value replaced by [REDACTED]. */
  str(s: string): string;
  /** A deep copy with every string (keys too) redacted. Non-plain values (numbers, booleans, null) pass through. */
  deep<T>(v: T): T;
};

/** Redaction of the real secret values (the API key, HAL_TOKEN). Every string Hal writes under .data goes through it. */
export function redactor(secrets: readonly string[]): Redactor {
  const keys = [...new Set(secrets.filter((s) => typeof s === 'string' && s.length > 0))].sort((a, b) => b.length - a.length);
  const str = (s: string) => keys.reduce((t, k) => t.split(k).join(REDACTED), s);
  const deep = (v: unknown): unknown => {
    if (typeof v === 'string') return str(v);
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [str(k), deep(x)]));
    return v;
  };
  return { str, deep: <T>(v: T) => deep(v) as T };
}

export type IsolatedCheckOptions = {
  cwd: string;
  /** The repo root: `<repo>/.hal.env` is unreadable to the check. */
  repo: string;
  secrets: readonly string[];
  /** Directories the check may write (plus its own private temp dir; never the shared tmpdir). */
  writable: string[];
  timeoutMs: number;
  /** Passed as $HAL_CHECK_NONCE (entry checks print `HAL-RESULT <nonce> <json>`). */
  nonce?: string;
  /** More paths the child may not write (on top of <cwd>/.git and, unless ownNodeModules, <cwd>/node_modules). */
  denyWrite?: string[];
  /** Extra env for the child (never secrets: values containing one are dropped). */
  extraEnv?: Record<string, string>;
  /** The tree has its own throwaway node_modules (ci:local after `npm ci`): not relinked from <repo>, not write-denied
   *  (it is not the trust root; vitest keeps its cache there). */
  ownNodeModules?: boolean;
  /** TESTS ONLY: run as a plain isolated child when sandbox-exec is unavailable. Hal never sets it. */
  unsandboxedForTests?: boolean;
};

/**
 * Runs argv in the tree `cwd` the way runCandidate runs its checks: <cwd>/node_modules is rebuilt from <repo>'s and
 * verified first, then the child runs in its own process group (killed afterwards) with a scrubbed env, under
 * sandbox-exec (no network but loopback, no .hal.env, writes only where allowed, never to <cwd>/node_modules). Fails
 * closed: without sandbox-exec the result is `{ code: null, error: 'no sandbox' }` and nothing is spawned; a
 * node_modules that does not verify is `{ code: null, error: 'node_modules: ...' }`.
 */
export async function isolatedCheck(argv: string[], o: IsolatedCheckOptions): Promise<IsolatedResult> {
  const unsandboxed = o.unsandboxedForTests === true;
  const none = (error: string): IsolatedResult => ({ code: null, stdout: '', stderr: '', timedOut: false, error });
  if (!unsandboxed && !sandboxAvailable()) return none('no sandbox');
  if (!o.ownNodeModules) {
    try {
      await linkNodeModules(o.cwd, o.repo);
      await verifyNodeModules(o.cwd, o.repo);
    } catch (e) { return none(errMsg(e)); }
  }
  const base = sandboxEnv(process.env, [...o.secrets]);
  const extra = Object.fromEntries(Object.entries(o.extraEnv ?? {}).filter(([, v]) => !o.secrets.some((s) => s && v.includes(s))));
  const env = { ...base, ...extra, ...(o.nonce ? { [NONCE_ENV]: o.nonce } : {}) };
  return runIsolated(argv, {
    cwd: o.cwd, env, timeoutMs: o.timeoutMs,
    ...(unsandboxed ? { unsandboxed: true } : {
      // .git too: a rewritten gitdir pointer (or config) would make Hal's next git call in this tree run a smudge filter.
      policy: { writable: o.writable /* + a private temp dir, added by runIsolated */, denyRead: [join(o.repo, '.hal.env')], denyWrite: [...(o.ownNodeModules ? [] : [join(o.cwd, 'node_modules')]), join(o.cwd, '.git'), ...(o.denyWrite ?? [])] },
    }),
  });
}

/** An entry check (score/screens/controls) through isolatedCheck with a fresh nonce; its one nonce'd result, or throws. */
export async function entryCheck<T>(argv: string[], o: Omit<IsolatedCheckOptions, 'nonce'>): Promise<T> {
  const nonce = randomBytes(16).toString('hex');
  const r = await isolatedCheck(argv, { ...o, nonce });
  if (r.error) throw new Error(r.error);
  if (r.code !== 0) throw new Error(`${r.timedOut ? 'timed out' : `exit ${r.code}`}: ${tail(r.stderr || r.stdout, 800)}`);
  return parseResult<T>(r.stdout, nonce);
}

/**
 * Fails closed before Hal's own git calls in a tree that checks ran in: refuses when the repo's or the worktree's git
 * config (anything under <repo> or <dir>, includes resolved) sets a filter driver, core.attributesFile or an include,
 * any of which could make a checkout run a program. Brian's global config (e.g. git-lfs) is not judged here.
 */
export async function assertNoRepoFilters(repo: string, dir: string, git: GitRunner): Promise<void> {
  const out = await git(['config', '--list', '--show-origin', '--includes'], dir);
  const roots = [resolve(repo), resolve(dir)].flatMap((r) => { try { return [r, realpathSync(r)]; } catch { return [r]; } });
  for (const line of out.split('\n')) {
    const m = /^file:(.*?)\t([^=]+)=/.exec(line);
    if (!m) continue;
    const [origin, key] = [resolve(dir, m[1]!), m[2]!.toLowerCase()]; // origins may be relative to dir (file:.git/config)
    if (!roots.some((r) => origin === r || origin.startsWith(r + sep))) continue;
    if (key.startsWith('filter.') || key === 'core.attributesfile' || key === 'include.path' || key.startsWith('includeif.')) {
      throw new Error(`git config ${origin} sets ${key}: refusing to run git here (a filter could run code)`);
    }
  }
}

/** The bytes of <dir>/.git (a worktree's gitdir pointer file), to compare before and after a check. */
export const dotGit = (dir: string): string => { try { return readFileSync(join(dir, '.git'), 'utf8'); } catch (e) { return `unreadable: ${errMsg(e)}`; } };

/** package.json's scripts from its text ({} if unreadable). */
export function scriptsOf(packageJson: string): Record<string, string> {
  try { return (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { return {}; }
}

/** The JSON object in a Claude reply: the whole text, a fenced block, or the span from the first `{` to the last `}`. */
export function extractJson(text: string): unknown {
  const tries = [text.trim()];
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fence) tries.push(fence[1]!.trim());
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a !== -1 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch { /* next */ }
  }
  return null;
}

export const errMsg = (e: unknown) => String((e as Error)?.message ?? e).trim();
export const tail = (s: string, n = 1500) => (s.length > n ? `...${s.slice(-n)}` : s);
