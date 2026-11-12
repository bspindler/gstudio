// Hal's ci:local in a temp repo whose package.json scripts are tiny node probes; npm ci installs nothing (empty lockfile).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ciLocalSandboxed, npmCiEnv } from './ci-sandboxed.js';
import { sandboxAvailable } from './sandbox.js';

const KEY = 'sk-ant-test-FAKE0123456789';
const gitIn = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
let repo: string;

function commit(scripts: Record<string, string>, files: Record<string, string> = {}): string {
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', scripts }, null, 2));
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.0.0' } } }, null, 2));
  for (const [p, t] of Object.entries(files)) writeFileSync(join(repo, p), t);
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '-m', 'c');
  return gitIn(repo, 'rev-parse', 'HEAD');
}
beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'hal-ci-')));
  gitIn(repo, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) gitIn(repo, 'config', k!, v!);
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.data/\n.hal.env\n');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const record = (sha: string) => JSON.parse(readFileSync(join(repo, '.data', 'ci', `${sha}.json`), 'utf8'));

const N = (code: string) => [process.execPath, '-e', code];
const F = (file: string) => [process.execPath, file];

describe('ciLocalSandboxed', () => {
  it('runs npm ci, then lint:infra (skipped without the script), typecheck, test; records ok; removes its worktree', async () => {
    const sha = commit({ typecheck: 'tsc -p x', test: 'vitest run' });
    const r = await ciLocalSandboxed(sha, { repo, secrets: [KEY], unsandboxedForTests: true, commands: { typecheck: [N('')], test: [N('console.log(1)')] } });
    expect(r.ok).toBe(true);
    expect(record(sha)).toMatchObject({ sha, ok: true, sandboxed: true });
    expect(record(sha).steps.map((s: { step: string; skipped?: string }) => [s.step, s.skipped ?? null])).toEqual([['npm ci', null], ['lint:infra', 'no lint:infra script'], ['typecheck', null], ['test', null]]);
    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  }, 60_000);
  it('a failing test step fails the record, stops there, and the tail is redacted', async () => {
    const sha = commit({ typecheck: 'tsc', test: 'vitest run', 'lint:infra': 'tsx lint.ts' }, { 'fail.js': `console.log('leaking ${KEY}'); process.exit(1);\n` });
    const r = await ciLocalSandboxed(sha, { repo, secrets: [KEY], unsandboxedForTests: true, hasAz: () => true, azureDir: join(repo, 'no-azure'), commands: { lint: [N('')], typecheck: [N('')], test: [F('fail.js')] } });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/failed: test/);
    const text = readFileSync(join(repo, '.data', 'ci', `${sha}.json`), 'utf8');
    expect(text).toContain('leaking [REDACTED]');
    expect(text).not.toContain(KEY);
    expect(r.detail).not.toContain(KEY);
    expect(record(sha).steps.map((s: { step: string }) => s.step)).toEqual(['npm ci', 'lint:infra', 'typecheck', 'test']);
  }, 60_000);
  it('lint:infra runs before any merged code: a test step that rewrites the lint script and package.json changes nothing for it', async () => {
    const tamper = `const fs=require('fs');fs.writeFileSync('lint.js','process.exit(9)');fs.writeFileSync('package.json','{"scripts":{"lint:infra":"node evil.js"}}');`;
    const sha = commit({ typecheck: 'tsc', test: 'vitest run', 'lint:infra': 'tsx lint.ts' }, { 'lint.js': `require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'hal-lint-ran-${process.pid}'), String(Date.now()));\n` });
    const marker = join(tmpdir(), `hal-lint-ran-${process.pid}`);
    rmSync(marker, { force: true });
    const r = await ciLocalSandboxed(sha, { repo, secrets: [], unsandboxedForTests: true, hasAz: () => true, azureDir: join(repo, 'no-azure'), commands: { lint: [F('lint.js')], typecheck: [N(tamper)], test: [F('lint.js')] } });
    expect(record(sha).steps.map((s: { step: string; ok: boolean }) => [s.step, s.ok])).toEqual([['npm ci', true], ['lint:infra', true], ['typecheck', true], ['test', false]]);
    expect(existsSync(marker)).toBe(true); // lint.js ran (as the lint step) before typecheck rewrote it
    rmSync(marker, { force: true });
    expect(r.ok).toBe(false); // the rewritten lint.js only ever ran as the test step
  }, 60_000);
  it('lint:infra refuses (and nothing else runs) when the worktree package.json is not the commit\'s bytes', async () => {
    // A checkout-time conversion makes the disk differ from the blob: the lint step must not trust the disk.
    const sha = commit({ 'lint:infra': 'tsx lint.ts', test: 'vitest run' }, { '.gitattributes': 'package.json text eol=crlf\n' });
    const r = await ciLocalSandboxed(sha, { repo, secrets: [], unsandboxedForTests: true, hasAz: () => true, azureDir: join(repo, 'no-azure'), commands: { lint: [N('')], typecheck: [N('')], test: [N('')] } });
    expect(r.ok).toBe(false);
    expect(record(sha).steps.map((s: { step: string; ok: boolean }) => [s.step, s.ok])).toEqual([['npm ci', true], ['lint:infra', false]]);
    expect(r.detail).toMatch(/not the commit/);
  }, 60_000);
  it('npm ci env drops credentials, Hal token, GIT_* and secret values', () => {
    const env = npmCiEnv({ PATH: '/bin', ANTHROPIC_API_KEY: KEY, ANTHROPIC_AUTH_TOKEN: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'o', HAL_TOKEN: 'h', GIT_DIR: '/x', OTHER: `x${KEY}` }, [KEY]);
    expect(env).toEqual({ PATH: '/bin', CI: 'true' });
  });
  it('a bad sha writes nothing and fails', async () => {
    const r = await ciLocalSandboxed('nope', { repo, secrets: [], unsandboxedForTests: true });
    expect(r.ok).toBe(false);
    expect(existsSync(join(repo, '.data', 'ci'))).toBe(false);
  });
  it.runIf(sandboxAvailable())('darwin: lint cannot write ~/.azure or the worktree; typecheck/test cannot write package.json, node_modules, .git or outside; no key; .hal.env unreadable', async () => {
    writeFileSync(join(repo, '.hal.env'), `ANTHROPIC_API_KEY=${KEY}\n`);
    const azure = join(homedir(), `.hal-azure-probe-${process.pid}`); // stands in for ~/.azure (outside tmp, like the real one)
    mkdirSync(join(azure, 'bin'), { recursive: true });
    const outside = join(homedir(), `.hal-ci-sandbox-probe-${process.pid}`);
    const P = (lines: string[], want: string) => `const fs=require('fs');const r=[];const t=(n,f)=>{try{f();r.push(n+':ok')}catch(e){r.push(n+':'+e.code)}};
${lines.join('\n')}
r.push('key:'+(Object.values(process.env).some(v=>String(v).includes(${JSON.stringify(KEY)}))?'yes':'none'));
console.log(r.join(' '));process.exit(r.join(' ')===${JSON.stringify(want)}?0:7);\n`;
    const lint = P([
      `t('azure',()=>fs.writeFileSync(${JSON.stringify(join(azure, 'bin', 'bicep'))},'x'));`,
      `t('wt',()=>fs.writeFileSync('scripts.txt','x'));`,
      `t('cfg',()=>fs.writeFileSync(require('path').join(process.env.AZURE_CONFIG_DIR,'x'),'x'));`,
      `t('read',()=>fs.readFileSync(${JSON.stringify(join(repo, '.hal.env'))}));`,
    ], 'azure:EPERM wt:EPERM cfg:ok read:EPERM key:none');
    const check = P([
      `t('pkg',()=>fs.writeFileSync('package.json','{}'));`,
      `t('nm',()=>fs.mkdirSync('node_modules/x',{recursive:true}));`,
      `t('git',()=>fs.writeFileSync('.git','gitdir: /tmp/evil'));`,
      `t('out',()=>fs.writeFileSync(${JSON.stringify(outside)},'x'));`,
      `t('wt',()=>fs.writeFileSync('ok.txt','x'));`,
    ], 'pkg:EPERM nm:EPERM git:EPERM out:EPERM wt:ok key:none');
    const sha = commit({ 'lint:infra': 'tsx lint.ts', typecheck: 'tsc', test: 'vitest run' }, { 'lint.js': lint, 'check.js': check });
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    let r;
    try {
      r = await ciLocalSandboxed(sha, { repo, secrets: [KEY], hasAz: () => true, azureDir: azure, commands: { lint: [F('lint.js')], typecheck: [F('check.js')], test: [F('check.js')] } });
    } finally { if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev; }
    const leaked = existsSync(outside) || existsSync(join(azure, 'bin', 'bicep'));
    rmSync(outside, { force: true });
    rmSync(azure, { recursive: true, force: true });
    expect(r.detail).toBe('passed');
    expect(leaked).toBe(false);
  }, 120_000);
});
