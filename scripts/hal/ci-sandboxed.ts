// Hal's ci:local (review fix rounds 1-2): the same steps and the same `.data/ci/<sha>.json` record as
// scripts/ci-local.ts, but the merged commit's own code never runs unsandboxed, and nothing it runs can reach a step
// that has more rights than it.
//   npm ci       unsandboxed (needs the registry). Safe: a candidate that touches package.json or the lockfile trips
//                `protected-path`/`dependency`, so what it installs is what Brian committed. Env scrubbed of secrets.
//   lint:infra   FIRST, right after npm ci, before any merged code has run: <wt>/package.json must still be the
//                commit's bytes, and the scripts come from those bytes. Sandboxed, writes only to a fresh temp dir:
//                AZURE_CONFIG_DIR is a temp copy holding only bin/bicep (an APFS clone) and a minimal config, the .NET
//                extract base is a fresh mkdtemp dir, and ~/.azure is write-denied. Skipped without the script or `az`.
//   typecheck,   sandboxed: no network but loopback, <repo>/.hal.env unreadable, writes only to the ci worktree and tmp,
//   test         never to <wt>/.git, <wt>/node_modules or <wt>/package.json. Run with the ci install's own tools
//                (vitest run gets --no-cache, as candidates do), argv from the commit's package.json scripts.
// The worktree is a detached checkout of <sha> in a fresh temp dir, made with Hal's safe git (no hooks), removed after.
// Every tail written to .data/ci is redacted. Plain `npm run ci:local` (Brian's) is unchanged.
import { spawn, spawnSync } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './env.js';
import { runGit, safeGit, type GitRunner } from './git.js';
import { resolveTools, scriptArgv } from './candidate.js';
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
  /** Brian's az config dir (only bin/bicep is copied from it; it is write-denied); default ~/.azure. */
  azureDir?: string;
  /** TESTS ONLY: argv sequences instead of the package.json scripts run with the ci install's tools. */
  commands?: Partial<Record<'lint' | 'typecheck' | 'test', string[][]>>;
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
  let lintTmp: string | undefined;
  let wt = '';
  try {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit sha: ${sha}`);
    dir = await mkdtemp(join(tmpdir(), `hal-ci-${sha.slice(0, 7)}-`));
    wt = join(dir, 'wt');
    await git(['worktree', 'add', '--detach', '--quiet', wt, sha], o.repo);
    let t0 = Date.now();
    // The commit's package.json, from the object store: the scripts come from these bytes, never from the disk.
    const pkg = await git(['cat-file', 'blob', `${sha}:package.json`], o.repo);
    const scripts = scriptsOf(pkg);
    const ci = await runNpmCi(wt, npmCiEnv(process.env, o.secrets), timeoutMs);
    let ok = step('npm ci', ci.code === 0, t0, ci.out);
    const argvOf = (k: 'lint' | 'typecheck' | 'test', script: string): string[][] => o.commands?.[k] ?? scriptArgv(script, resolveTools(wt));
    /** Each argv of the sequence, sandboxed; the step fails at the first non-zero exit. */
    const sandboxed = async (name: string, seq: () => string[][], more: { writable?: string[]; denyWrite?: string[]; extraEnv?: Record<string, string> }) => {
      t0 = Date.now();
      let argvs: string[][];
      try { argvs = seq(); } catch (e) { return step(name, false, t0, errMsg(e)); }
      let out = '';
      for (const argv of argvs) {
        const r = await isolatedCheck(argv, {
          cwd: wt, repo: o.repo, secrets: o.secrets, writable: more.writable ?? [], timeoutMs, ownNodeModules: true,
          ...(more.denyWrite ? { denyWrite: more.denyWrite } : {}), ...(more.extraEnv ? { extraEnv: more.extraEnv } : {}),
          ...(o.unsandboxedForTests ? { unsandboxedForTests: true } : {}),
        });
        out += `${r.stdout}\n${r.stderr}${r.timedOut ? '\n(timed out)' : ''}${r.error ? `\n${r.error}` : ''}`;
        if (r.code !== 0) return step(name, false, t0, out);
      }
      return step(name, true, t0, out);
    };
    if (ok) {
      // lint:infra first: no merged code has run yet, and package.json is still the commit's.
      const az = (o.hasAz ?? (() => spawnSync('sh', ['-c', 'command -v az']).status === 0))();
      if (!scripts['lint:infra']) step('lint:infra', true, Date.now(), '', 'no lint:infra script');
      else if (!az) step('lint:infra', true, Date.now(), '', 'az not installed');
      else if ((await readFile(join(wt, 'package.json'), 'utf8').catch(() => '')) !== pkg) ok = step('lint:infra', false, Date.now(), 'package.json in the ci worktree is not the commit\'s');
      else {
        lintTmp = await mkdtemp(join(tmpdir(), 'hal-lint-'));
        const azDir = o.azureDir ?? join(homedir(), '.azure');
        const cfg = join(lintTmp, 'azure');
        await mkdir(join(cfg, 'bin'), { recursive: true });
        // Only what bicep needs (measured): its binary and a config that keeps it on that binary, no tokens, no extensions.
        await writeFile(join(cfg, 'config'), '[bicep]\nuse_binary_from_path = false\ncheck_version = false\n[core]\ncollect_telemetry = no\n[extension]\nuse_dynamic_install = no\n');
        if (existsSync(join(azDir, 'bin', 'bicep'))) {
          await copyFile(join(azDir, 'bin', 'bicep'), join(cfg, 'bin', 'bicep'), constants.COPYFILE_FICLONE);
          await chmod(join(cfg, 'bin', 'bicep'), 0o755);
        }
        const dotnet = await mkdtemp(join(lintTmp, 'dotnet-'));
        ok = await sandboxed('lint:infra', () => argvOf('lint', scripts['lint:infra']!), {
          writable: [lintTmp], denyWrite: [azDir, wt], extraEnv: { AZURE_CONFIG_DIR: cfg, DOTNET_BUNDLE_EXTRACT_BASE_DIR: dotnet },
        });
      }
    }
    const guarded = { writable: [wt], denyWrite: [join(wt, 'node_modules'), join(wt, 'package.json')] };
    if (ok) ok = await sandboxed('typecheck', () => argvOf('typecheck', scripts.typecheck ?? ''), guarded);
    if (ok) ok = await sandboxed('test', () => argvOf('test', scripts.test ?? ''), guarded);
  } catch (e) {
    steps.push({ step: 'setup', ok: false, seconds: 0, tail: redact(errMsg(e)) });
  } finally {
    if (wt) await git(['worktree', 'remove', '--force', '--force', wt], o.repo).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (lintTmp) await rm(lintTmp, { recursive: true, force: true }).catch(() => {});
    await git(['worktree', 'prune'], o.repo).catch(() => {});
  }
  const record: CiRecord = {
    sha, ref: 'refs/hal/main', ok: steps.length > 0 && steps.every((s) => s.ok), at: (o.now ?? (() => new Date()))().toISOString(), node: process.version, steps, sandboxed: true,
  };
  if (/^[0-9a-f]{40}$/.test(sha)) await writeJsonAtomic(join(o.repo, '.data', 'ci', `${sha}.json`), redactor(o.secrets).deep(record)).catch(() => {});
  const failed = steps.filter((s) => !s.ok).map((s) => s.step);
  return { ok: record.ok, detail: record.ok ? 'passed' : `failed: ${failed.join(', ')}${steps.find((s) => !s.ok)?.tail ? `\n${steps.find((s) => !s.ok)!.tail!.slice(-600)}` : ''}`, record };
}
