// The sandbox for Claude-written code (R13). Pure parts run everywhere; real sandbox-exec runs only on macOS.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runIsolated, sandboxAvailable, sandboxEnv, sandboxProfile, type SandboxPolicy } from './sandbox.js';

const KEY = 'sk-ant-api03-SANDBOXTESTKEY0123456789';
const node = (code: string) => [process.execPath, '-e', code];

describe('sandboxEnv / sandboxProfile', () => {
  it('drops credentials, Hal\'s token, GIT_* and any value holding a secret; keeps the rest', () => {
    const base = { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: KEY, ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', HAL_TOKEN: 'h', GIT_DIR: '/x', SNEAKY: `pre${KEY}`, KEEP: '1' };
    const env = sandboxEnv(base, [KEY]);
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'HAL_TOKEN', 'GIT_DIR', 'SNEAKY']) expect(env[k], k).toBeUndefined();
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', KEEP: '1', CI: '1', HAL_SANDBOXED: '1' });
    expect(env.npm_config_cache).toBe(join(tmpdir(), 'hal-npm-cache'));
    expect(base.ANTHROPIC_API_KEY).toBe(KEY); // never mutated
  });
  it('denies network except loopback, writes except the given paths and /dev, and reads of the denied files; quotes paths', () => {
    const p = sandboxProfile({ writable: ['/w/a "b"'], denyRead: ['/r/.hal.env'] });
    expect(p).toContain('(allow default)');
    expect(p).toContain('(deny network-outbound)');
    expect(p).toContain('(allow network-outbound (remote ip "localhost:*"))');
    expect(p).toContain('(deny file-write*)');
    expect(p).toContain('(subpath "/w/a \\"b\\"")');
    expect(p).toContain('(deny file-read* (literal "/r/.hal.env"))');
    expect(p.indexOf('(deny file-write*)')).toBeLessThan(p.indexOf('(allow file-write*')); // later rules win
  });
  it('requires a policy unless explicitly unsandboxed', () => {
    expect(() => runIsolated(['true'], { cwd: tmpdir(), env: {}, timeoutMs: 1000 })).toThrow(/policy is required/);
  });
});

describe.runIf(process.platform === 'darwin')('runIsolated under sandbox-exec (darwin)', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hal-sbx-')));
  const repo = join(root, 'repo');
  const wt = join(repo, '.data/hal/wt/HAL-1');
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(repo, '.hal.env'), `ANTHROPIC_API_KEY=${KEY}\n`);
  // Writable: the worktree only (not tmpdir), so a write elsewhere under the temp root must fail.
  const policy: SandboxPolicy = { writable: [wt], denyRead: [join(repo, '.hal.env')] };
  const env = sandboxEnv({ ...process.env, ANTHROPIC_API_KEY: KEY }, [KEY]);
  const run = (code: string, timeoutMs = 20_000) => runIsolated(node(code), { cwd: wt, env, timeoutMs, policy });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('is available here', () => expect(sandboxAvailable()).toBe(true));

  it('cannot read a fake .hal.env, and sees no key in its env', async () => {
    const r = await run(`let s; try { require('fs').readFileSync(${JSON.stringify(join(repo, '.hal.env'))}, 'utf8'); s = 'READ'; } catch (e) { s = e.code; } console.log(s, process.env.ANTHROPIC_API_KEY ?? 'nokey')`);
    expect(r.stdout.trim()).toBe('EPERM nokey');
  });

  it('cannot connect to a non-loopback address: EPERM at once, not a timeout', async () => {
    const t0 = Date.now();
    const r = await run(`require('net').connect(80, '10.255.255.1').on('error', (e) => { console.log(e.code); process.exit(0); }).on('connect', () => { console.log('CONNECTED'); process.exit(0); })`);
    expect(r.stdout.trim()).toBe('EPERM');
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('can reach a loopback server (screens and controls serve on 127.0.0.1)', async () => {
    const server = createServer((_q, s) => s.end('pong')).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const port = (server.address() as AddressInfo).port;
      const r = await run(`fetch('http://127.0.0.1:${port}/').then((x) => x.text()).then((t) => console.log(t), (e) => console.log('ERR', e.cause?.code ?? e.message))`);
      expect(r.stdout.trim()).toBe('pong');
    } finally { server.close(); }
  });

  it('can write inside the worktree but nowhere else', async () => {
    const outside = join(root, 'outside.txt');
    const r = await run(`const fs = require('fs'); fs.writeFileSync('inside.txt', 'ok'); try { fs.writeFileSync(${JSON.stringify(outside)}, 'x'); console.log('ESCAPED'); } catch (e) { console.log(e.code); }`);
    expect(r.stdout.trim()).toBe('EPERM');
    expect(existsSync(join(wt, 'inside.txt'))).toBe(true);
    expect(existsSync(outside)).toBe(false);
  });

  it('kills the whole process group when the check ends, and on timeout', async () => {
    // The child leaves a grandchild (same group) behind and exits.
    const r = await run(`const c = require('child_process').spawn('sleep', ['60'], { stdio: 'ignore' }); console.log(c.pid); process.exit(0)`);
    const pid = Number(r.stdout.trim());
    expect(pid).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 200));
    expect(() => process.kill(pid, 0)).toThrow(); // gone
    const t = await run('setTimeout(() => {}, 60000)', 500);
    expect(t.timedOut).toBe(true);
  });
});
