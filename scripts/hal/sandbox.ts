// Isolation for Claude-written code that Hal runs (ruling R13): npm test, typecheck, test listing, scorers, screens,
// controls and shots of a candidate each run as a child process, in their own process group (killed afterwards), with
// a scrubbed env, under macOS sandbox-exec: allow by default, but no outbound network except loopback, no reading
// <repo>/.hal.env, no writes outside the paths given (the worktree and the child's own private temp dir; never the
// shared os.tmpdir(), where tsx keeps an unverified transform cache Hal itself would load), and none to the denyWrite paths
// (the worktree's node_modules). Fails closed without sandbox-exec.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { childEnv } from './env.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** sandbox-exec exists and we are not already inside a Hal sandbox (macOS cannot nest them; sandboxEnv sets HAL_SANDBOXED). */
export const sandboxAvailable = (): boolean => process.platform === 'darwin' && existsSync(SANDBOX_EXEC) && process.env.HAL_SANDBOXED !== '1';

export type SandboxPolicy = {
  /** Directories (and everything under them) the child may write. /dev is always writable. */
  writable: string[];
  /** Files or folders (and everything under them) the child may not read. */
  denyRead: string[];
  /** Directories under a writable one that stay read-only (the worktree's node_modules). */
  denyWrite?: string[];
};

const q = (p: string) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** The path as given, and its real path (sandbox rules match resolved paths: /var -> /private/var). */
function variants(p: string): string[] {
  const abs = resolve(p);
  // A path that does not exist yet (a deny on node_modules before it is made) still needs its real spelling: resolve the
  // nearest existing ancestor and re-append the rest, or /var/... would never match the sandbox's /private/var/....
  let real = abs, rest = '';
  for (let cur = abs; ; ) {
    try { real = join(realpathSync(cur), rest); break; } catch { /* not there yet */ }
    const up = dirname(cur);
    if (up === cur) { real = abs; break; }
    rest = rest ? join(basename(cur), rest) : basename(cur);
    cur = up;
  }
  return [...new Set([abs, real])];
}

/** SBPL for sandbox-exec -p. Later rules win, so each deny is followed by its narrow allow. */
export function sandboxProfile(p: SandboxPolicy): string {
  const writable = p.writable.flatMap(variants).map((d) => `(subpath ${q(d)})`).join(' ');
  const denyRead = p.denyRead.flatMap(variants).map((f) => `(subpath ${q(f)})`).join(' ');
  const denyWrite = (p.denyWrite ?? []).flatMap(variants).map((d) => `(subpath ${q(d)})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(deny file-write*)',
    `(allow file-write* (subpath "/dev")${writable ? ` ${writable}` : ''})`,
    ...(denyWrite ? [`(deny file-write* ${denyWrite})`] : []),
    ...(denyRead ? [`(deny file-read* ${denyRead})`] : []),
  ].join('\n');
}

const SECRET_KEYS = /^(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|HAL_TOKEN)$/;
/** `base` (never mutated) without Claude credentials, Hal's token, GIT_* overrides, or any value containing a secret; npm kept off ~/.npm. */
export function sandboxEnv(base: NodeJS.ProcessEnv, secrets: string[]): NodeJS.ProcessEnv {
  const keys = secrets.filter((s) => s.length > 0);
  const env = childEnv(base, 'subscription');
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (SECRET_KEYS.test(k) || /^GIT_/.test(k) || (v !== undefined && keys.some((s) => v.includes(s)))) delete env[k];
  }
  // TMPDIR/TMP/TEMP and the npm cache are set per child by runIsolated (a private dir), never the shared tmpdir.
  return { ...env, CI: '1', npm_config_update_notifier: 'false', HAL_SANDBOXED: '1' };
}

export type IsolatedResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; error?: string };
export type IsolatedOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Required unless `unsandboxed` (tests only). */
  policy?: SandboxPolicy;
  unsandboxed?: boolean;
};

const MAX_OUT = 32 * 1024 * 1024;

/** Process groups of isolated checks (and other detached children Hal registers) still running. */
const liveGroups = new Set<number>();
/** Registers a detached child's process group so killLiveGroups() reaches it; returns the unregister function. */
export function trackGroup(pid: number | undefined): () => void {
  if (!pid) return () => {};
  liveGroups.add(pid);
  return () => { liveGroups.delete(pid); };
}
/** SIGKILLs every tracked process group: for Hal's SIGINT/SIGTERM/exit handler, next to killLiveClaudeChildren. */
export function killLiveGroups(): void {
  for (const pid of liveGroups) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
  liveGroups.clear();
}
/** tsx's transform cache in the shared tmpdir (`<os.tmpdir()>/tsx-<uid>`): unverified, loaded by Hal's own tsx. */
export const tsxCacheDir = (): string => join(tmpdir(), `tsx-${process.getuid?.() ?? 'x'}`);
const same = (a: string, b: string) => { const r = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } }; return r(a) === r(b); };

const killGroup = (pid: number | undefined) => { if (pid) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };

/**
 * Runs argv in its own process group, sandboxed by `policy`, and SIGKILLs the whole group when it ends or times out.
 * Never rejects: a spawn error is `{ code: null, error }`. Throws only on a missing policy (a programming error).
 */
export function runIsolated(argv: string[], o: IsolatedOptions): Promise<IsolatedResult> {
  if (!o.unsandboxed && !o.policy) throw new Error('runIsolated: a sandbox policy is required');
  if (o.policy?.writable.some((w) => same(w, tmpdir()))) throw new Error('runIsolated: the shared tmpdir may not be writable (each child gets its own)');
  // The child's own temp dir: TMPDIR/TMP/TEMP and the npm cache point here, it is the only temp dir it may write, and
  // it is removed afterwards. A child can no longer plant anything in the shared tmpdir for a later process.
  const priv = mkdtempSync(join(tmpdir(), 'hal-child-'));
  const env = { ...o.env, TMPDIR: priv, TMP: priv, TEMP: priv, npm_config_cache: join(priv, 'npm-cache') };
  const policy: SandboxPolicy | undefined = o.policy && {
    ...o.policy, writable: [...o.policy.writable, priv], denyWrite: [...(o.policy.denyWrite ?? []), tsxCacheDir()],
  };
  const [cmd, args] = o.unsandboxed ? [argv[0]!, argv.slice(1)] : [SANDBOX_EXEC, ['-p', sandboxProfile(policy!), ...argv]];
  return new Promise((done) => {
    let stdout = '', stderr = '', timedOut = false, finished = false;
    const child = spawn(cmd, args, { cwd: o.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const untrack = trackGroup(child.pid);
    const finish = (r: IsolatedResult) => {
      if (finished) return;
      finished = true; clearTimeout(timer); killGroup(child.pid); untrack();
      try { rmSync(priv, { recursive: true, force: true }); } catch { /* best effort */ }
      done(r);
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, o.timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout = (stdout + d.toString('utf8')).slice(-MAX_OUT); });
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-MAX_OUT); });
    child.on('error', (e) => finish({ code: null, stdout, stderr, timedOut, error: e.message }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }));
  });
}
