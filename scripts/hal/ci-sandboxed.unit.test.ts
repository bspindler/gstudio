// Hal's ci:local in a temp repo whose package.json scripts are tiny node probes; npm ci installs nothing (empty lockfile).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

describe('ciLocalSandboxed', () => {
  it('runs npm ci, typecheck, test (lint:infra skipped without the script), records ok, and removes its worktree', async () => {
    const sha = commit({ typecheck: 'node -e ""', test: 'node -e "console.log(1)"' });
    const r = await ciLocalSandboxed(sha, { repo, secrets: [KEY], unsandboxedForTests: true });
    expect(r.ok).toBe(true);
    expect(record(sha)).toMatchObject({ sha, ok: true, sandboxed: true });
    expect(record(sha).steps.map((s: { step: string; skipped?: string }) => [s.step, s.skipped ?? null])).toEqual([['npm ci', null], ['typecheck', null], ['test', null], ['lint:infra', 'no lint:infra script']]);
    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  }, 60_000);
  it('a failing test step fails the record, stops there, and the tail is redacted', async () => {
    const sha = commit({ typecheck: 'node -e ""', test: 'node fail.js', 'lint:infra': 'node -e ""' }, { 'fail.js': `console.log('leaking ${KEY}'); process.exit(1);\n` });
    const r = await ciLocalSandboxed(sha, { repo, secrets: [KEY], unsandboxedForTests: true, hasAz: () => true });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/failed: test/);
    const text = readFileSync(join(repo, '.data', 'ci', `${sha}.json`), 'utf8');
    expect(text).toContain('leaking [REDACTED]');
    expect(text).not.toContain(KEY);
    expect(r.detail).not.toContain(KEY);
    expect(record(sha).steps.map((s: { step: string }) => s.step)).toEqual(['npm ci', 'typecheck', 'test']);
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
  it.runIf(sandboxAvailable())('darwin: typecheck and test really run sandboxed (.hal.env unreadable, no writes outside tmp/worktree, no key)', async () => {
    writeFileSync(join(repo, '.hal.env'), `ANTHROPIC_API_KEY=${KEY}\n`);
    const outside = join(homedir(), `.hal-ci-sandbox-probe-${process.pid}`);
    const probe = `const fs=require('fs');const r=[];
try{fs.readFileSync(${JSON.stringify(join(repo, '.hal.env'))});r.push('read:ok')}catch(e){r.push('read:'+e.code)}
try{fs.writeFileSync(${JSON.stringify(outside)},'x');r.push('write:ok')}catch(e){r.push('write:'+e.code)}
try{fs.writeFileSync('.git','gitdir: /tmp/evil\\n');r.push('git:ok')}catch(e){r.push('git:'+e.code)}
r.push('key:'+(Object.values(process.env).some(v=>String(v).includes(${JSON.stringify(KEY)}))?'yes':'none'));
console.log(r.join(' '));process.exit(r.join(' ')==='read:EPERM write:EPERM git:EPERM key:none'?0:7);\n`;
    const sha = commit({ typecheck: 'node probe.js', test: 'node probe.js' }, { 'probe.js': probe });
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    let r;
    try { r = await ciLocalSandboxed(sha, { repo, secrets: [KEY] }); } finally { if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev; }
    const leaked = existsSync(outside);
    rmSync(outside, { force: true });
    expect(leaked).toBe(false);
    expect(r.detail).toBe('passed');
    expect(r.ok).toBe(true);
  }, 120_000);
});
