// Read-only git history for the implementer (plan 2026-11-15 part C): `npm run hal -- git log|show|diff|blame ...`.
// The argv check is the policy layer (allowlisted subcommands and options, hardened config and env); the implementer's
// sandbox (no writes outside the worktree and its temp dir, no network) is the hard boundary, tested at the end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asksCheck, gitReadArgv, gitReadEnv, runGitRead, GIT_READ_CONFIG } from './git-read.js';
import { runIsolated, sandboxAvailable, sandboxEnv } from './sandbox.js';
import { implementerSandboxSettings, roleAllowedTools } from './claude.js';
import { main } from './cli.js';

const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const argv = (args: string[]) => { const r = gitReadArgv(args); if ('error' in r) throw new Error(r.error); return r.argv; };
const refused = (args: string[]) => { const r = gitReadArgv(args); return 'error' in r ? r.error : null; };

describe('gitReadArgv: allowlisted, hardened', () => {
  it('runs log, show, diff and blame with no pager, hardened config, no ext diff and no textconv', () => {
    const a = argv(['log', '--oneline', '-n', '5', '--', 'games/gearhold/camera.js']);
    expect(a.slice(0, 1 + GIT_READ_CONFIG.length)).toEqual(['--no-pager', ...GIT_READ_CONFIG]);
    expect(a.slice(1 + GIT_READ_CONFIG.length)).toEqual(['log', '--no-ext-diff', '--no-textconv', '--oneline', '-n', '5', '--', 'games/gearhold/camera.js']);
    for (const k of ['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.pager=cat', 'diff.external=', 'protocol.allow=never', 'log.showSignature=false', 'gpg.program=false']) {
      expect(GIT_READ_CONFIG).toContain(k);
    }
    expect(argv(['show', 'HEAD~3:games/gearhold/camera.js'])).toContain('HEAD~3:games/gearhold/camera.js');
    expect(argv(['diff', 'HEAD~5', 'HEAD', '--stat'])).toContain('--stat');
    expect(argv(['diff', 'HEAD~5..HEAD'])).toContain('HEAD~5..HEAD');
    expect(argv(['log', '-p', '-S', 'cameraFor', '--format=%h %s', '-L', '10,20:games/gearhold/camera.js'])).toContain('-S');
    expect(argv(['log', '-5', '--since=2026-11-01', '--grep=camera'])).toContain('-5');
    const blame = argv(['blame', '-L', '1,40', 'games/gearhold/camera.js']);
    expect(blame).toContain('blame');
    expect(blame).toContain('--no-textconv');
    expect(blame).not.toContain('--no-ext-diff'); // blame has no such option
  });

  it.each([
    ['push'], ['fetch'], ['pull'], ['checkout', 'HEAD~1'], ['reset', '--hard'], ['commit', '-m', 'x'], ['stash'], ['config', 'core.pager', 'x'],
    ['remote', 'add', 'x', 'y'], ['worktree', 'add', '../x'], ['update-ref', 'refs/heads/x', 'HEAD'], ['gc'], ['apply', 'p'], ['am'], ['rebase'],
    ['tag', 'x'], ['branch', 'x'], ['notes', 'add'], ['clean', '-fd'], ['restore', '.'], ['switch', 'x'], ['cat-file', '-p', 'HEAD'], ['archive', 'HEAD'],
    [], ['--git-dir=/tmp/x', 'log'], ['-c', 'core.pager=sh', 'log'], ['-C', '/tmp', 'log'], ['--exec-path=/tmp', 'log'],
  ])('refuses anything but log/show/diff/blame first: git %j', (...args) => {
    expect(refused(args as string[])).toMatch(/only|subcommand/);
  });

  it.each([
    [['log', '--output=/tmp/x']], [['log', '--output', 'x']], [['log', '--outp=x']], [['diff', '-o', 'x']], [['log', '--ext-diff']], [['log', '--textconv']],
    [['diff', '--no-index', 'a', 'b']], [['log', '--show-signature']], [['log', '--format=%G?']], [['log', '--pretty=format:%GS']], [['log', '-c', 'x']],
    [['blame', '--contents', 'x', 'f']], [['blame', '-S', 'revs', 'f']], [['blame', '--ignore-revs-file=x', 'f']], [['log', '-O/etc/order']], [['log', '--exec=sh']],
    [['log', '--git-dir=/x']], [['log', '--work-tree=/x']], [['diff', '--output-indicator-new=x', '--output=y']], [['log', '-pw']], [['log', '--paginate']],
    [['log', '--open-files-in-pager']], [['show', '--ext-diff', 'HEAD']], [['log', '--config-env=core.pager=X']], [['log', '--upload-pack=x']],
  ])('refuses a writing, executing or unknown option: git %j', (args) => {
    expect(refused(args)).toMatch(/not allowed|refused/);
  });

  it('refuses absolute paths and .. path segments (git diff would read files outside the repo), but allows a..b ranges', () => {
    expect(refused(['diff', '/etc/hosts', '/etc/passwd'])).toMatch(/outside/);
    expect(refused(['log', '--', '../other'])).toMatch(/outside/);
    expect(refused(['show', 'HEAD:../../x'])).toBeNull(); // a path inside a tree object, never the disk
    expect(refused(['diff', '~/x', 'y'])).toMatch(/outside/);
    expect(refused(['log', 'HEAD~2..HEAD'])).toBeNull();
    expect(refused(['log', 'a...b'])).toBeNull();
  });

  it('gitReadEnv drops GIT_* overrides and secrets, ignores system and global config, and never takes optional locks or prompts', () => {
    const env = gitReadEnv({ PATH: '/bin', HOME: '/h', GIT_DIR: '/evil', GIT_EXTERNAL_DIFF: 'sh', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', ANTHROPIC_API_KEY: 'k', HAL_TOKEN: 't', PAGER: 'sh' });
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_PAGER: 'cat', PAGER: 'cat' });
    for (const k of ['GIT_DIR', 'GIT_EXTERNAL_DIFF', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'ANTHROPIC_API_KEY', 'HAL_TOKEN']) expect(env[k]).toBeUndefined();
  });

  it('npm run hal -- git refuses with exit 2 before anything runs; asks needs `check --game <slug>`', async () => {
    const deps = { scorers: {}, halDir: '/nonexistent/.data/hal', repo: '/nonexistent' };
    expect(await main(['git', 'push', 'origin'], deps)).toBe(2);
    expect(await main(['git', 'log', '--output=x'], deps)).toBe(2);
    expect(await main(['asks', 'apply'], deps)).toBe(1);
    expect(await main(['asks', 'check', '--game', '../x'], deps)).toBe(1);
  });

  it('the implementer sandbox can write its worktree, temp and score dirs, never the shared .git a worktree reads history from', () => {
    const repo = '/r/games';
    const set = implementerSandboxSettings({ cwd: `${repo}/.data/hal/wt/HAL-1`, denyReadPaths: [`${repo}/.hal.env`], tmpDir: '/t/hal-claude-x', scoreDir: '/t/hal-ask-x' }) as { sandbox: { filesystem: { allowWrite: string[]; denyRead: string[] } } };
    const w = set.sandbox.filesystem.allowWrite;
    expect(w).toEqual([`${repo}/.data/hal/wt/HAL-1`, '/t/hal-claude-x', '/t/hal-ask-x']);
    for (const d of w) expect(`${repo}/.git/`.startsWith(`${d}/`) || d.startsWith(`${repo}/.git`)).toBe(false);
    expect(set.sandbox.filesystem.denyRead.some((p) => p.includes('/.git'))).toBe(false); // history stays readable
  });

  it('the implementer may run it (and the asks check), and nothing broader', () => {
    const tools = roleAllowedTools('implementer');
    expect(tools).toContain('Bash(npm run hal -- git:*)');
    expect(tools).toContain('Bash(npm run hal -- asks check:*)');
    expect(tools.some((t) => /^Bash\(git[ :]/.test(t))).toBe(false); // never bare git
  });
});

describe('runGitRead and asksCheck in a real repo worktree', () => {
  let repo: string, wt: string;
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'hal-gitread-')));
    gitIn(repo, 'init', '-q', '-b', 'main');
    put(repo, 'games/gearhold/camera.js', 'export const cameraFor = 7;\n');
    put(repo, 'packages/core/test/hal-gearhold.test.ts', 'one\nexpect(n).toBe(3);\nthree\n');
    put(repo, '.gitignore', '.data/\n');
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'first camera');
    put(repo, 'games/gearhold/camera.js', 'export const cameraFor = 9;\n');
    gitIn(repo, 'commit', '-q', '-am', 'second camera');
    wt = join(repo, '.data', 'hal', 'wt', 'HAL-1');
    gitIn(repo, 'worktree', 'add', '-q', '--detach', wt, 'HEAD');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const capture = async (args: string[], cwd = wt) => {
    let out = '', err = '';
    const code = await runGitRead(args, cwd, { stdout: (s) => { out += s; }, stderr: (s) => { err += s; } });
    return { code, out, err };
  };

  it('shows history from a worktree (the shared .git), and refuses with exit 2 before running git', async () => {
    const log = await capture(['log', '--format=%s']);
    expect(log.code).toBe(0);
    expect(log.out.split('\n').filter(Boolean)).toEqual(['second camera', 'first camera']);
    const old = await capture(['show', 'HEAD~1:games/gearhold/camera.js']);
    expect(old.out).toContain('cameraFor = 7');
    const d = await capture(['diff', 'HEAD~1', 'HEAD']);
    expect(d.out).toContain('+export const cameraFor = 9;');
    const no = await capture(['log', '--output=x']);
    expect(no.code).toBe(2);
    expect(no.err).toMatch(/not allowed/);
  });

  it('ignores an external diff tool in the repo config (--no-ext-diff) and GIT_EXTERNAL_DIFF in the env', async () => {
    const marker = join(repo, 'ext-ran');
    gitIn(repo, 'config', 'diff.external', `sh -c 'touch ${marker}'`);
    const prev = process.env.GIT_EXTERNAL_DIFF;
    process.env.GIT_EXTERNAL_DIFF = `sh -c 'touch ${marker}'`;
    try {
      const d = await capture(['diff', 'HEAD~1', 'HEAD']);
      expect(d.code).toBe(0);
      expect(d.out).toContain('cameraFor = 9');
      expect(() => readFileSync(marker)).toThrow();
    } finally {
      if (prev === undefined) delete process.env.GIT_EXTERNAL_DIFF; else process.env.GIT_EXTERNAL_DIFF = prev;
      gitIn(repo, 'config', '--unset', 'diff.external');
    }
  });

  it('asksCheck: validates hal-asks.patch (paths, then git apply --check) without writing anything', async () => {
    const p = 'packages/core/test/hal-gearhold.test.ts';
    const good = `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,3 +1,3 @@\n one\n-expect(n).toBe(3);\n+expect(n).toBe(LEVELS.length);\n three\n`;
    const lines: string[] = [];
    const io = { stdout: (s: string) => { lines.push(s); }, stderr: (s: string) => { lines.push(s); } };
    expect(await asksCheck(wt, 'gearhold', io)).toBe(1);
    expect(lines.join('')).toMatch(/no hal-asks\.patch/);
    writeFileSync(join(wt, 'hal-asks.patch'), good);
    lines.length = 0;
    expect(await asksCheck(wt, 'gearhold', io)).toBe(0);
    expect(lines.join('')).toMatch(/applies cleanly/);
    expect(readFileSync(join(wt, p), 'utf8')).toContain('toBe(3)'); // --check writes nothing
    writeFileSync(join(wt, 'hal-asks.patch'), good.replaceAll(p, 'policy.yaml'));
    lines.length = 0;
    expect(await asksCheck(wt, 'gearhold', io)).toBe(1);
    expect(lines.join('')).toMatch(/policy\.yaml.*refused/);
    writeFileSync(join(wt, 'hal-asks.patch'), good.replace('expect(n).toBe(3);', 'not there'));
    lines.length = 0;
    expect(await asksCheck(wt, 'gearhold', io)).toBe(1);
    expect(lines.join('')).toMatch(/does not apply/);
    rmSync(join(wt, 'hal-asks.patch'));
  });

  // The hard boundary, with Hal's own sandbox profile given the implementer's write set (the worktree and a temp dir):
  // history reads work through the worktree's gitdir pointer, and git cannot write refs or objects in the shared .git.
  it.runIf(sandboxAvailable())('sandboxed: git log works in the worktree, and update-ref / commit / gc cannot write the shared .git', async () => {
    const env = sandboxEnv(process.env, []);
    const policy = { writable: [wt], denyRead: [] };
    const run = (args: string[]) => runIsolated(['/usr/bin/git', ...args], { cwd: wt, env, timeoutMs: 30_000, policy });
    const log = await run(['log', '--oneline']);
    expect(log.code).toBe(0);
    expect(log.stdout).toContain('second camera');
    const before = gitIn(repo, 'for-each-ref');
    expect((await run(['update-ref', 'refs/heads/evil', 'HEAD'])).code).not.toBe(0);
    expect((await run(['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '--allow-empty', '-m', 'x'])).code).not.toBe(0);
    expect(gitIn(repo, 'for-each-ref')).toBe(before);
  });
});
