// Adapter around headless Claude Code (`claude -p --output-format json`) for Hal's three roles.
// It controls billing (API key vs subscription), the per-call spend cap, tool permissions and result parsing.
// It never records spend: the caller does (see @studio/core/hal), using `costUsd`.
import type { ChildProcess, SpawnOptions } from 'node:child_process';
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
export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
export type ClaudeDeps = {
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
  now: () => number;
  /** The key from .hal.env; only used (and required) for billing 'api'. */
  apiKey?: string;
};

export const ALWAYS_DISALLOWED: string[] = [
  'WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(curl:*)', 'Bash(wget:*)',
  'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(npx:*)', 'Bash(gh:*)',
];

/** Deny beats allow in Claude Code, so the implementer runs focused tests via `npm test`, never `npx vitest`. */
export function roleAllowedTools(role: ClaudeRole): string[] {
  switch (role) {
    case 'planner': return ['Read', 'Glob', 'Grep'];
    case 'implementer':
      return ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(npm run typecheck)', 'Bash(npm run hal -- score:*)'];
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

export function buildArgs(call: ClaudeCall): string[] {
  const denied = [...new Set([...ALWAYS_DISALLOWED, ...call.disallowedTools])];
  const args = [
    '-p', '--output-format', 'json',
    '--max-budget-usd', String(call.maxBudgetUsd),
    '--model', call.model,
    '--no-session-persistence',
    '--permission-mode', 'acceptEdits',
  ];
  // --allowedTools/--disallowedTools are variadic: one comma-joined value each, and the prompt goes after `--`.
  if (call.allowedTools.length > 0) args.push('--allowedTools', call.allowedTools.join(','));
  args.push('--disallowedTools', denied.join(','));
  if (call.billing === 'api') {
    args.push('--bare'); // never reads OAuth / keychain
    if (call.appendSystemPromptFile) args.push('--append-system-prompt-file', call.appendSystemPromptFile);
  } else {
    args.push('--strict-mcp-config', '--setting-sources', 'project'); // keep personal hooks/plugins out of Hal
  }
  args.push('--', call.prompt);
  return args;
}

export async function runClaude(call: ClaudeCall, deps: ClaudeDeps): Promise<ClaudeResult> {
  // Throws `no API key in .hal.env` (no key value) before anything is spawned.
  const env = childEnv(deps.env, call.billing, deps.apiKey);
  const key = call.billing === 'api' ? deps.apiKey : undefined;
  const child = deps.spawn('claude', buildArgs(call), { cwd: call.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise<ClaudeResult>((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let done = false;
    let termTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const signal = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch { try { child.kill(sig); } catch { /* already gone */ } }
    };
    const build = (r: Omit<ClaudeResult, 'stderrTail' | 'limitHit' | 'timedOut'> & { limitText?: string }): ClaudeResult => {
      const stderrTail = redact(err, key).slice(-STDERR_TAIL_MAX);
      const text = redact(r.text, key);
      return {
        ok: r.ok, text, costUsd: r.costUsd, subtype: r.subtype,
        limitHit: LIMIT_RE.test(text) || LIMIT_RE.test(stderrTail), timedOut, stderrTail,
      };
    };
    const finish = (r: ClaudeResult) => {
      if (done) return;
      done = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      resolve(r);
    };

    child.stdout?.on('data', (d: Buffer | string) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer | string) => { err += d.toString(); });
    child.on('error', (e: Error) => {
      err += `${err ? '\n' : ''}${e.message}`;
      finish(build({ ok: false, text: '', costUsd: null, subtype: 'spawn_error' }));
    });
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

    termTimer = setTimeout(() => {
      timedOut = true;
      signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
    }, call.timeoutMs);
  });
}

/** Subscription call that hits a usage limit is retried once on the API with a fresh slice; both results are returned so both get recorded. */
export async function runClaudeWithFallback(
  call: ClaudeCall,
  deps: ClaudeDeps,
  apiSliceUsd: number = call.maxBudgetUsd,
): Promise<{ first: ClaudeResult; retry?: ClaudeResult }> {
  const first = await runClaude(call, deps);
  if (call.billing !== 'subscription' || !first.limitHit) return { first };
  const retry = await runClaude({ ...call, billing: 'api', maxBudgetUsd: apiSliceUsd }, deps);
  return { first, retry };
}
