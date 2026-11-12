// Hal's ci:local (review fix round 1, critical 1): the same steps and the same `.data/ci/<sha>.json` record as
// scripts/ci-local.ts, but the merged commit's own code never runs unsandboxed.
//   npm ci       unsandboxed (needs the registry). Safe: a candidate that touches package.json or the lockfile trips
//                `protected-path`/`dependency`, so what it installs is what Brian committed. Env scrubbed of secrets.
//   typecheck,   isolatedCheck, sandboxed: no network but loopback, <repo>/.hal.env unreadable, writes only to the ci
//   test,        worktree and tmp, its .git write-denied, own process group. lint:infra only if the script exists and
//   lint:infra   `az` is installed (as ci-local.ts), also sandboxed (plus ~/.azure writable, a tmp .NET extract dir).
// The worktree is a detached checkout of <sha> in a fresh temp dir, made with Hal's safe git (no hooks), removed after.
// Every tail written to .data/ci is redacted. Plain `npm run ci:local` (Brian's) is unchanged.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './env.js';
import { runGit, safeGit, type GitRunner } from './git.js';
import { errMsg, isolatedCheck, redactor, scriptsOf } from './run-util.js';
import { trackGroup } from './sandbox.js';
import { writeJsonAtomic } from './store.js';

export type CiStep = { step: string; ok: boolean; skipped?: string; seconds: number; tail?: string };
export type CiRecord = { sha: string; ref: string; ok: boolean; at: string; node: string; steps: CiStep[]; sandboxed: true };
export type CiSandboxedOptions = {
  repo: string;
  secrets: readonly string[];
  now?: () => Date;
  /** Per step; default 30 minutes. */
  timeoutMs?: number;
  git?: GitRunner;
  /** Whether `az` is on PATH (lint:infra); default `command -v az`. */
  hasAz?: () => boolean;
  /** TESTS ONLY: run the sandboxed steps as plain isolated children. */
  unsandboxedForTests?: boolean;
};

const STEP_TIMEOUT_MS = 30 * 60_000;
const TAIL_LINES = 40;
const lastLines = (s: string) => s.split('\n').slice(-TAIL_LINES).join('\n');

/** The env for the unsandboxed `npm ci`: no Claude credentials, no Hal token, no value containing a secret. */
export function npmCiEnv(base: NodeJS.ProcessEnv, secrets: readonly string[]): NodeJS.ProcessEnv {
  const env = childEnv(base, 'subscription');
  for (const k of Object.keys(env)) {
    const v = env[k];
    if (/^(?:HAL_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)$/.test(k) || /^GIT_/.test(k) || (v !== undefined && secrets.some((s) => s && v.includes(s)))) delete env[k];
  }
  return { ...env, CI: 'true' };
}

function runNpmCi(wt: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('npm', ['ci', '--no-audit', '--no-fund'], { cwd: wt, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const untrack = trackGroup(child.pid);
    const kill = () => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } };
    const timer = setTimeout(kill, timeoutMs);
    const add = (b: Buffer) => { out = (out + b.toString()).slice(-200_000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const done = (code: number | null, extra = '') => { clearTimeout(timer); kill(); untrack(); resolve({ code, out: out + extra }); };
    child.on('error', (e) => done(null, `\n${e.message}`));
    child.on('close', (code) => done(code));
  });
}

/** Runs the ci steps for `sha` and writes `<repo>/.data/ci/<sha>.json`. Never throws; `detail` is for warnings. */
export async function ciLocalSandboxed(sha: string, o: CiSandboxedOptions): Promise<{ ok: boolean; detail: string; record: CiRecord }> {
  const { str: redact } = redactor(o.secrets);
  const git = safeGit(o.git ?? runGit);
  const timeoutMs = o.timeoutMs ?? STEP_TIMEOUT_MS;
  const steps: CiStep[] = [];
  const step = (name: string, ok: boolean, t0: number, out: string, skipped?: string) => {
    steps.push({ step: name, ok, seconds: Math.round((Date.now() - t0) / 100) / 10, ...(skipped ? { skipped } : {}), ...(ok ? {} : { tail: redact(lastLines(out)) }) });
    return ok;
  };
  let dir: string | undefined;
  let wt = '';
  try {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit sha: ${sha}`);
    dir = await mkdtemp(join(tmpdir(), `hal-ci-${sha.slice(0, 7)}-`));
    wt = join(dir, 'wt');
    await git(['worktree', 'add', '--detach', '--quiet', wt, sha], o.repo);
    let t0 = Date.now();
    const ci = await runNpmCi(wt, npmCiEnv(process.env, o.secrets), timeoutMs);
    let ok = step('npm ci', ci.code === 0, t0, ci.out);
    const sandboxed = async (name: string, argv: string[], more: { writable?: string[]; extraEnv?: Record<string, string> } = {}) => {
      t0 = Date.now();
      const r = await isolatedCheck(argv, {
        cwd: wt, repo: o.repo, secrets: o.secrets, writable: [wt, ...(more.writable ?? [])], timeoutMs, ownNodeModules: true,
        ...(more.extraEnv ? { extraEnv: more.extraEnv } : {}),
        ...(o.unsandboxedForTests ? { unsandboxedForTests: true } : {}),
      });
      return step(name, r.code === 0, t0, `${r.stdout}\n${r.stderr}${r.timedOut ? '\n(timed out)' : ''}${r.error ? `\n${r.error}` : ''}`);
    };
    if (ok) ok = await sandboxed('typecheck', ['npm', 'run', 'typecheck']);
    if (ok) ok = await sandboxed('test', ['npm', 'test']);
    if (ok) {
      const scripts = scriptsOf(await readFile(join(wt, 'package.json'), 'utf8').catch(() => '{}'));
      const az = (o.hasAz ?? (() => spawnSync('sh', ['-c', 'command -v az']).status === 0))();
      if (!scripts['lint:infra']) step('lint:infra', true, Date.now(), '', 'no lint:infra script');
      else if (!az) step('lint:infra', true, Date.now(), '', 'az not installed');
      // az keeps its logs and bicep binary under ~/.azure, and bicep (.NET) needs an extract dir. Measured on this Mac:
      // lint:infra passes sandboxed with exactly these. Nothing it runs is Claude-written: infra/** is protected and
      // scripts/ is outside every candidate's scope (R18).
      else await sandboxed('lint:infra', ['npm', 'run', 'lint:infra'], { writable: [join(homedir(), '.azure')], extraEnv: { DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(tmpdir(), 'hal-dotnet') } });
    }
  } catch (e) {
    steps.push({ step: 'setup', ok: false, seconds: 0, tail: redact(errMsg(e)) });
  } finally {
    if (wt) await git(['worktree', 'remove', '--force', '--force', wt], o.repo).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    await git(['worktree', 'prune'], o.repo).catch(() => {});
  }
  const record: CiRecord = {
    sha, ref: 'refs/hal/main', ok: steps.length > 0 && steps.every((s) => s.ok), at: (o.now ?? (() => new Date()))().toISOString(), node: process.version, steps, sandboxed: true,
  };
  if (/^[0-9a-f]{40}$/.test(sha)) await writeJsonAtomic(join(o.repo, '.data', 'ci', `${sha}.json`), redactor(o.secrets).deep(record)).catch(() => {});
  const failed = steps.filter((s) => !s.ok).map((s) => s.step);
  return { ok: record.ok, detail: record.ok ? 'passed' : `failed: ${failed.join(', ')}${steps.find((s) => !s.ok)?.tail ? `\n${steps.find((s) => !s.ok)!.tail!.slice(-600)}` : ''}`, record };
}
