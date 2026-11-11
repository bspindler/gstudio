// Local stand-in for .github/workflows/ci.yml, for when GitHub Actions can't run.
// Checks out <ref> (default HEAD) into a fresh detached worktree, so uncommitted files and the
// current node_modules can't make it pass, then runs the same steps as CI's build and infra jobs:
//   npm ci -> npm run typecheck -> npm test -> npm run lint:infra (skipped with a note if az is missing)
// Extras: --browser also runs the opt-in HAL_BROWSER suite; --pages also runs build:pages.
// The result is written to .data/ci/<sha>.json so Hal (and people) can see which commits passed.
// Not covered: the Windows legs of the matrix.
//
//   npm run ci:local -- [ref] [--browser] [--pages] [--keep]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type StepResult = { step: string; ok: boolean; skipped?: string; seconds: number; tail?: string };
export type CiResult = { sha: string; ref: string; ok: boolean; at: string; node: string; steps: StepResult[] };

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const ref = args.find((a) => !a.startsWith('--')) ?? 'HEAD';
const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();

const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

const dir = mkdtempSync(join(tmpdir(), `ci-local-${sha.slice(0, 7)}-`));
const wt = join(dir, 'wt');
execFileSync('git', ['worktree', 'add', '--detach', wt, sha], { cwd: repo, stdio: 'ignore' });

const steps: StepResult[] = [];
function run(step: string, cmd: string, cmdArgs: string[], env: NodeJS.ProcessEnv = {}): boolean {
  const t0 = Date.now();
  process.stdout.write(`▶ ${step} … `);
  const r = spawnSync(cmd, cmdArgs, { cwd: wt, encoding: 'utf8', env: { ...process.env, CI: 'true', ...env }, maxBuffer: 256 * 1024 * 1024 });
  const ok = r.status === 0;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  steps.push({ step, ok, seconds, ...(ok ? {} : { tail: out.split('\n').slice(-40).join('\n') }) });
  console.log(ok ? `ok (${seconds}s)` : `FAILED (${seconds}s)`);
  if (!ok) console.log(out.split('\n').slice(-40).join('\n'));
  return ok;
}
const skip = (step: string, why: string) => {
  steps.push({ step, ok: true, skipped: why, seconds: 0 });
  console.log(`▷ ${step} skipped: ${why}`);
};

try {
  console.log(`ci:local ${ref} @ ${sha.slice(0, 7)} (node ${process.version})`);
  const ok =
    run('npm ci', 'npm', ['ci', '--no-audit', '--no-fund']) &&
    run('typecheck', 'npm', ['run', 'typecheck']) &&
    run('test', 'npm', ['test']);
  if (ok) {
    if (has('az')) run('lint:infra', 'npm', ['run', 'lint:infra']);
    else skip('lint:infra', 'az not installed');
    if (flag('--browser')) run('hal browser tests', 'npx', ['vitest', 'run', '--project', 'hal-browser'], { HAL_BROWSER: '1' });
    if (flag('--pages')) run('build:pages', 'npm', ['run', 'build:pages']);
  }
} finally {
  const result: CiResult = { sha, ref, ok: steps.length > 0 && steps.every((s) => s.ok), at: new Date().toISOString(), node: process.version, steps };
  mkdirSync(join(repo, '.data', 'ci'), { recursive: true });
  writeFileSync(join(repo, '.data', 'ci', `${sha}.json`), JSON.stringify(result, null, 2) + '\n');
  if (!flag('--keep')) {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo });
    rmSync(dir, { recursive: true, force: true });
  } else console.log(`kept ${wt}`);
  console.log(result.ok ? `\n✅ ci:local passed for ${sha.slice(0, 7)}` : `\n❌ ci:local FAILED for ${sha.slice(0, 7)}`);
  process.exitCode = result.ok ? 0 : 1;
}
