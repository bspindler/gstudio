// Adapter around headless Claude Code (`claude -p --output-format json`) for Hal's three roles.
// It controls billing (API key vs subscription), the per-call spend cap, tool permissions and result parsing.
// It never records spend: the caller does (see @studio/core/hal), using `costUsd`.
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { childEnv } from './env.js';

export type ClaudeRole = 'planner' | 'implementer' | 'director';
export type ClaudeCall = {
  role: ClaudeRole;
  prompt: string;
  cwd: string;
  billing: 'api' | 'subscription';
  maxBudgetUsd: number;
  model: string;
  allowedTools: string[];
  disallowedTools: string[];
  timeoutMs: number;
  appendSystemPromptFile?: string;
  /**
   * Absolute paths the implementer's sandboxed Bash may not read; required (non-empty) for the implementer, else
   * runClaude returns `no_deny_paths` without spawning. The caller passes `<repo>/.hal.env`: the cwd is a worktree,
   * so the repo's .hal.env cannot be derived from it. `<cwd>/.hal.env` is always denied as well.
   */
  denyReadPaths?: string[];
  /** Extra directories the role's tools may reach (`--add-dir`), e.g. the planner's screenshot folder. */
  addDirs?: string[];
  /**
   * The call's private temp dir (set by runClaude: a fresh mkdtemp, removed after the call). TMPDIR/TMP/TEMP and
   * CLAUDE_CODE_TMPDIR point here, and it is the implementer sandbox's only temp dir: the shared tmpdir is never writable.
   */
  tmpDir?: string;
};
export type ClaudeResult = {
  ok: boolean;
  text: string;
  costUsd: number | null;
  subtype: string;
  limitHit: boolean;
  timedOut: boolean;
  stderrTail: string;
};
type ChildLike = ChildProcess;
export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
export type ClaudeDeps = {
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
  now: () => number;
  /** The key from .hal.env; only used (and required) for billing 'api'. */
  apiKey?: string;
};

/** Every edit tool, for every form of a node_modules path the permission syntax matches (cwd-relative and any depth). */
export const NODE_MODULES_WRITE_DENY: string[] = ['Edit', 'Write', 'NotebookEdit'].flatMap((t) => [
  `${t}(node_modules/**)`, `${t}(./node_modules/**)`, `${t}(**/node_modules/**)`, `${t}(node_modules)`, `${t}(**/node_modules)`,
]);

/** Every edit tool, for `.git` at the cwd and at any depth, and anything under one. */
export const GIT_WRITE_DENY: string[] = ['Edit', 'Write', 'NotebookEdit'].flatMap((t) => [`${t}(.git)`, `${t}(./.git)`, `${t}(**/.git)`, `${t}(**/.git/**)`]);

export const ALWAYS_DISALLOWED: string[] = [
  'WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(curl:*)', 'Bash(wget:*)',
  'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(npx:*)', 'Bash(gh:*)',
  // The API key lives in .hal.env; no role may read or change it. Rules are gitignore-style: bare/`./` are
  // relative to the cwd, `**/` matches at any depth (CLI 2.1.322 uses `//` for absolute and `~/` for home).
  ...['Read', 'Edit', 'Write', 'Grep'].flatMap((t) => [`${t}(.hal.env)`, `${t}(./.hal.env)`, `${t}(**/.hal.env)`]),
  // A worktree's node_modules entries are symlinks into <repo>/node_modules (Hal's tools, and Brian's checkout): no
  // edit may go through them. Reads stay allowed (the implementer may look at library types).
  ...NODE_MODULES_WRITE_DENY,
  // A worktree's .git is its gitdir pointer (and a repo's .git its config and hooks): no edit tool may touch it.
  ...GIT_WRITE_DENY,
];

/**
 * Absolute deny rules for `denyReadPaths`, for every role. In 2.1.322's permission matcher a rule path starting with
 * `//` is absolute from the filesystem root (a single `/` is relative to the settings root): the bundle's path resolver
 * does `if (e.startsWith("//")) return Md(H0(e.slice(1)))`. So `/abs/.hal.env` becomes `Read(//abs/.hal.env)`.
 */
export function absoluteDenyRules(paths: string[]): string[] {
  return paths.flatMap((p) => ['Read', 'Grep', 'Edit', 'Write'].flatMap((t) => [`${t}(/${resolve(p)})`, `${t}(/${resolve(p)}/**)`]));
}
/** Deny paths go into one comma/space-separated --disallowedTools value: refuse any that could split a rule. */
const unsafeRulePath = (p: string) => /[\s,()]/.test(p) || !isAbsolute(p);

/** Built-in tool set per role (`--tools`); `--allowedTools` only pre-approves, it does not restrict. */
export function roleTools(role: ClaudeRole): string {
  switch (role) {
    case 'planner': return 'Read,Glob,Grep';
    case 'implementer': return 'Read,Edit,Write,Glob,Grep,Bash';
    case 'director': return ''; // no tools at all
  }
}

/**
 * Pre-approved tool rules. Never a bare `Read`/`Edit`/`Write`/`Glob`/`Grep`: a bare rule approves every path, outside the
 * repo too (live probe, 2.1.322). Without one, reads in the cwd and --add-dir folders are allowed by default, edits in
 * the cwd by acceptEdits, and anything else asks, which a -p run refuses. Deny beats allow in Claude Code, so the
 * implementer runs focused tests via `npm test`, never `npx vitest`.
 */
export function roleAllowedTools(role: ClaudeRole): string[] {
  switch (role) {
    case 'planner': return [];
    case 'implementer':
      return ['Bash(npm test:*)', 'Bash(npm run typecheck)', 'Bash(npm run hal -- score:*)'];
    case 'director': return [];
  }
}

// Subscription / spend limit wording, verified by grepping the claude 2.1.322 binary:
//   "You've hit your limit", "You've hit your session limit", "You've hit your monthly limit",
//   "You've hit your monthly spend limit · your <name> resets <time>", "You've hit your team's shared budget",
//   "You've reached your Fable limit", "You're out of usage credits",
//   "usage limit reached" (also in "Goal paused · usage limit reached"), "spend limit reached · resets Aug 8".
// `rate limit.*subscription` is kept from the plan for older wordings.
export const LIMIT_RE = /you['’]ve (?:hit|reached) your .*?(?:limit|budget)|usage limit reached|spend limit reached|out of usage credits|rate limit.*subscription/i;

const STDERR_TAIL_MAX = 4000;
const KILL_GRACE_MS = 10_000;
const POST_KILL_WAIT_MS = 2_000;

const live = new Set<ChildLike>();
/** SIGKILL every Claude child's process group still running; for Hal's SIGINT/exit handler. */
export function killLiveClaudeChildren(): void {
  for (const c of live) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGKILL');
      else c.kill('SIGKILL');
    } catch { /* already gone */ }
  }
  live.clear();
}

function redact(s: string, key?: string): string {
  return key ? s.split(key).join('[REDACTED]') : s;
}

function lastJsonObject(out: string): Record<string, unknown> | null {
  const lines = out.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (!l.startsWith('{')) continue;
    try {
      const v = JSON.parse(l);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* try earlier line */ }
  }
  try { // whole-output (pretty-printed) JSON
    const v = JSON.parse(out.trim());
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* none */ }
  return null;
}

/** Env vars sandboxed commands never see (`credentials.envVars` deny unsets them inside the sandbox only). */
export const SANDBOX_DENIED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'HAL_TOKEN'];

/**
 * `--settings` JSON that runs the implementer's Bash inside Claude Code's sandbox (macOS Seatbelt / Linux bubblewrap).
 * Every key was verified in the claude 2.1.322 bundle's settings schema:
 *   sandbox.enabled                     run Bash inside the sandbox
 *   sandbox.failIfUnavailable           exit at startup if the sandbox cannot start (fail closed, never unsandboxed)
 *   sandbox.allowUnsandboxedCommands    false: the Bash `dangerouslyDisableSandbox` parameter is ignored; from a
 *                                       --settings file it also makes project settings' excludedCommands,
 *                                       allowedDomains, allowWrite etc. be ignored
 *   sandbox.autoAllowBashIfSandboxed    false: sandboxing does not pre-approve Bash; only --allowedTools rules run
 *   sandbox.excludedCommands            [] nothing runs outside the sandbox
 *   sandbox.network.allowedDomains      [] no outbound host
 *   sandbox.network.strictAllowlist     true: hosts not allowed are denied deterministically, never prompted
 *   sandbox.network.allowLocalBinding   true (macOS): tests may listen on 127.0.0.1 (loopback only)
 *   sandbox.filesystem.denyRead         .hal.env paths
 *   sandbox.filesystem.allowWrite       cwd (the worktree) and the temp dir
 *   sandbox.credentials.envVars         [{name, mode:'deny'}]: unset in sandboxed commands
 * `--setting-sources project` does not drop --settings (flag settings are a separate source).
 */
export function implementerSandboxSettings(call: Pick<ClaudeCall, 'cwd' | 'denyReadPaths' | 'tmpDir'>): object {
  const denyRead = [...new Set([join(call.cwd, '.hal.env'), ...(call.denyReadPaths ?? [])])];
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      excludedCommands: [],
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: true },
      // Worktree git metadata stays outside allowWrite on purpose: the allowed Bash is only npm test/typecheck/hal score; Hal does every git write itself, unsandboxed.
      // Never the shared tmpdir (tsx's transform cache there is loaded by Hal itself): the worktree and the call's own dir.
      filesystem: { denyRead, allowWrite: [call.cwd, ...(call.tmpDir ? [call.tmpDir] : [])] },
      credentials: { envVars: SANDBOX_DENIED_ENV.map((name) => ({ name, mode: 'deny' })) },
    },
  };
}

export function buildArgs(call: ClaudeCall): string[] {
  const denied = [...new Set([...ALWAYS_DISALLOWED, ...absoluteDenyRules(call.denyReadPaths ?? []), ...call.disallowedTools])];
  const args = [
    '-p', '--output-format', 'json',
    '--max-budget-usd', String(call.maxBudgetUsd),
    '--model', call.model,
    '--no-session-persistence',
    '--tools', roleTools(call.role), // "" disables every tool (director)
    '--setting-sources', 'project',
  ];
  if (call.role === 'implementer') {
    args.push('--permission-mode', 'acceptEdits'); // planner/director: default mode
    // The implementer's Bash runs code Claude wrote (tests); sandbox it in both billing modes.
    args.push('--settings', JSON.stringify(implementerSandboxSettings(call)));
  }
  for (const d of call.addDirs ?? []) args.push('--add-dir', d);
  // --allowedTools/--disallowedTools are variadic: one comma-joined value each, and the prompt is sent on stdin.
  if (call.allowedTools.length > 0) args.push('--allowedTools', call.allowedTools.join(','));
  args.push('--disallowedTools', denied.join(','));
  if (call.billing === 'api') args.push('--bare'); // never reads OAuth / keychain
  else args.push('--strict-mcp-config'); // keep personal hooks/plugins out of Hal
  // R24: the repo's CLAUDE.md, the same way for every role in both billings (--bare skips CLAUDE.md auto-discovery).
  if (call.appendSystemPromptFile) args.push('--append-system-prompt-file', call.appendSystemPromptFile);
  return args; // the prompt goes on stdin, not argv
}

export async function runClaude(call: ClaudeCall, deps: ClaudeDeps): Promise<ClaudeResult> {
  if (!(call.maxBudgetUsd > 0)) {
    return { ok: false, text: '', costUsd: null, subtype: 'no_budget', limitHit: false, timedOut: false, stderrTail: '' };
  }
  // The implementer must name <repo>/.hal.env explicitly; never fall back to the cwd-only deny (fail closed).
  if (call.role === 'implementer' && !(call.denyReadPaths && call.denyReadPaths.length > 0)) {
    return { ok: false, text: '', costUsd: null, subtype: 'no_deny_paths', limitHit: false, timedOut: false, stderrTail: '' };
  }
  if ((call.denyReadPaths ?? []).some(unsafeRulePath)) {
    return { ok: false, text: '', costUsd: null, subtype: 'bad_deny_path', limitHit: false, timedOut: false, stderrTail: '' };
  }
  // Throws `no API key in .hal.env` (no key value) before anything is spawned.
  const env = childEnv(deps.env, call.billing, deps.apiKey);
  // A private temp dir per call. Claude Code 2.1.322 gives its sandboxed Bash TMPDIR=$CLAUDE_CODE_TMPDIR (else
  // $CLAUDE_TMPDIR, else /tmp/claude) and keeps its own temp root there; Node and tools use TMPDIR/TMP/TEMP.
  const tmpDir = mkdtempSync(join(tmpdir(), 'hal-claude-'));
  call = { ...call, tmpDir };
  Object.assign(env, { TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir, CLAUDE_CODE_TMPDIR: tmpDir });
  delete env.CLAUDE_TMPDIR;
  delete env.HAL_TOKEN; // the dashboard token is never a child's business (childEnv returns a fresh copy)
  // R24: the same CLAUDE.md context in both billings: only the file passed with --append-system-prompt-file. --bare
  // (api) already skips CLAUDE.md discovery and auto-memory; a subscription call would otherwise load the user's own
  // ~/.claude/CLAUDE.md, CLAUDE.local.md, the cwd's CLAUDE.md and auto-memory. In the 2.1.322 bundle every CLAUDE.md
  // loader (managed, user, project, local, nested) returns [] when CLAUDE_CODE_DISABLE_CLAUDE_MDS is set, and auto-memory
  // is "off" when CLAUDE_CODE_DISABLE_AUTO_MEMORY is set; neither touches auth or --settings. (--safe-mode was not used:
  // it disables "all customizations", and nothing says it keeps --settings, which carries the implementer's sandbox.)
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  // R23: the implementer's own `npm test` runs inside Claude Code's sandbox, where Hal's nested sandbox tests cannot
  // run (macOS cannot nest sandbox-exec): they skip on HAL_SANDBOXED=1. Hal runs the full suite itself afterwards.
  if (call.role === 'implementer') env.HAL_SANDBOXED = '1';
  const key = call.billing === 'api' ? deps.apiKey : undefined;
  const child = deps.spawn('claude', buildArgs(call), { cwd: call.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  live.add(child);

  return new Promise<ClaudeResult>((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let done = false;
    let termTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let giveUpTimer: NodeJS.Timeout | undefined;

    const signal = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch { try { child.kill(sig); } catch { /* already gone */ } }
    };
    const build = (r: Omit<ClaudeResult, 'stderrTail' | 'limitHit' | 'timedOut'>): ClaudeResult => {
      const stderrTail = redact(err, key).slice(-STDERR_TAIL_MAX);
      const text = redact(r.text, key);
      return {
        ok: r.ok, text, costUsd: r.costUsd, subtype: r.subtype,
        // Only a failed call can be limit-blocked; a successful answer may merely mention the words.
        limitHit: !r.ok && !timedOut && (LIMIT_RE.test(text) || LIMIT_RE.test(stderrTail)), timedOut, stderrTail,
      };
    };
    const finish = (r: ClaudeResult) => {
      if (done) return;
      done = true;
      // A timed-out call's grandchildren (its Bash, tests, browsers) may outlive the leader: SIGKILL the whole group
      // however the call ended, by 'exit'/'close' or the give-up timer, even if the leader is already gone.
      if (timedOut) signal('SIGKILL');
      live.delete(child);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      clearTimeout(giveUpTimer);
      resolve(r);
    };

    child.stdout?.on('data', (d: Buffer | string) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer | string) => { err += d.toString(); });
    child.on('error', (e: Error) => {
      err += `${err ? '\n' : ''}${e.message}`;
      finish(build({ ok: false, text: '', costUsd: null, subtype: 'spawn_error' }));
    });
    child.on('exit', () => { if (timedOut) finishTimeout(); });
    child.on('close', (code: number | null) => {
      if (timedOut) return finish(build({ ok: false, text: redact(out, key).slice(-STDERR_TAIL_MAX), costUsd: null, subtype: 'timeout' }));
      const j = lastJsonObject(out);
      if (!j) {
        return finish(build({ ok: false, text: out.trim(), costUsd: null, subtype: code === 0 || code === null ? 'no_json' : `exit_${code}` }));
      }
      const subtype = typeof j.subtype === 'string' ? j.subtype : 'unknown';
      const cost = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null;
      const text = typeof j.result === 'string' ? j.result : '';
      finish(build({ ok: subtype === 'success' && !j.is_error && code === 0, text, costUsd: cost, subtype }));
    });

    child.stdin?.on('error', () => { /* EPIPE if the child exits early */ });
    child.stdin?.end(call.prompt);
    const finishTimeout = () => finish(build({ ok: false, text: redact(out, key).slice(-STDERR_TAIL_MAX), costUsd: null, subtype: 'timeout' }));

    termTimer = setTimeout(() => {
      timedOut = true;
      signal('SIGTERM');
      killTimer = setTimeout(() => {
        signal('SIGKILL');
        giveUpTimer = setTimeout(finishTimeout, POST_KILL_WAIT_MS); // resolve even if 'close' never fires
      }, KILL_GRACE_MS);
    }, call.timeoutMs);
  });
}
