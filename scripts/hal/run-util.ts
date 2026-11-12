// Small helpers shared by the run (run.ts) and undo (undo.ts): secret redaction for everything written under .data,
// the isolated (sandboxed) check runner for Hal's own checks outside a candidate, and lenient JSON extraction.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { NONCE_ENV, parseResult } from './candidate.js';
import { linkNodeModules, verifyNodeModules } from './git.js';
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
  /** Directories the check may write (tmpdir is always added). */
  writable: string[];
  timeoutMs: number;
  /** Passed as $HAL_CHECK_NONCE (entry checks print `HAL-RESULT <nonce> <json>`). */
  nonce?: string;
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
  try {
    await linkNodeModules(o.cwd, o.repo);
    await verifyNodeModules(o.cwd, o.repo);
  } catch (e) { return none(errMsg(e)); }
  const base = sandboxEnv(process.env, [...o.secrets]);
  const env = o.nonce ? { ...base, [NONCE_ENV]: o.nonce } : base;
  return runIsolated(argv, {
    cwd: o.cwd, env, timeoutMs: o.timeoutMs,
    ...(unsandboxed ? { unsandboxed: true } : {
      policy: { writable: [...o.writable, tmpdir()], denyRead: [join(o.repo, '.hal.env')], denyWrite: [join(o.cwd, 'node_modules')] },
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
