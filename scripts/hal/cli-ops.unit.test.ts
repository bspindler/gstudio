// setup / install / uninstall / serve with temp dirs, a fake launchctl and fake interfaces. Nothing touches ~/Library or launchd.
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOpsCommand, type OpsDeps } from './cli-ops.js';
import { nightlyPlist, serverPlist } from './launchd.js';

let out: string[], repo: string, home: string, calls: string[][];
beforeEach(async () => {
  out = []; calls = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  repo = await mkdtemp(join(tmpdir(), 'hal-ops-repo-'));
  home = await mkdtemp(join(tmpdir(), 'hal-ops-home-'));
});
afterEach(() => vi.restoreAllMocks());
const ifaces = () => ({ lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], en0: [{ family: 'IPv4', internal: false, address: '192.168.1.23' }] }) as never;
const deps = (o: Partial<OpsDeps> = {}): OpsDeps => ({
  halDir: join(repo, '.data/hal'), games: ['tidepool-pals'], repo, execPath: '/opt/node & co/bin/node', home,
  launchctl: (a) => { calls.push(a); }, interfaces: ifaces, isTTY: true, ...o,
});

describe('setup', () => {
  it('creates .hal.env with mode 0600 and a 32-byte base64url token, prints the bookmark', async () => {
    expect(await runOpsCommand('setup', [], deps())).toBe(0);
    const text = await readFile(join(repo, '.hal.env'), 'utf8');
    const m = /^HAL_TOKEN=([A-Za-z0-9_-]{43})\n$/.exec(text);
    expect(m).not.toBeNull();
    expect((await stat(join(repo, '.hal.env'))).mode & 0o777).toBe(0o600);
    expect(out.join('\n')).toContain(`http://192.168.1.23:5180/?t=${m![1]}`);
  });
  it('never overwrites an existing token, and never prints or alters the API key', async () => {
    const before = 'ANTHROPIC_API_KEY=sk-secret\nHAL_TOKEN=keepme\n';
    await writeFile(join(repo, '.hal.env'), before);
    await runOpsCommand('setup', [], deps());
    expect(await readFile(join(repo, '.hal.env'), 'utf8')).toBe(before);
    expect(out.join('\n')).not.toContain('sk-secret');
  });
  it('appends the token to an existing file lacking one, preserving the other lines', async () => {
    await writeFile(join(repo, '.hal.env'), 'ANTHROPIC_API_KEY=sk-secret');
    await runOpsCommand('setup', [], deps());
    const t = await readFile(join(repo, '.hal.env'), 'utf8');
    expect(t).toMatch(/^ANTHROPIC_API_KEY=sk-secret\nHAL_TOKEN=[A-Za-z0-9_-]{43}\n$/);
    expect(out.join('\n')).not.toContain('sk-secret');
  });
});

describe('plists', () => {
  const o = { execPath: '/opt/node & co/bin/node', repo: '/Users/a<b>/repo', halDir: '/Users/a<b>/repo/.data/hal' };
  it('nightly: 01:00 default, caffeinate, npm run hal -- run --nightly, escaped (snapshot)', () => {
    const x = nightlyPlist(o);
    expect(x).toMatchSnapshot();
    expect(x).toContain('<key>Hour</key>\n    <integer>1</integer>');
    expect(x).toContain('<string>/usr/bin/caffeinate</string>');
    expect(x).toContain('&amp;'); expect(x).toContain('a&lt;b&gt;');
    expect(x).not.toMatch(/a<b>|node & co/);
  });
  it('nightly honours --at', () => {
    expect(nightlyPlist({ ...o, at: { hour: 3, minute: 30 } })).toMatch(/<integer>3<\/integer>[\s\S]*<integer>30<\/integer>/);
  });
  it('server: KeepAlive, serve --lan --quiet (snapshot)', () => {
    const x = serverPlist(o);
    expect(x).toMatchSnapshot();
    expect(x).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(x).toContain('<string>--quiet</string>');
  });
});

describe('install / uninstall', () => {
  const agents = () => join(home, 'Library/LaunchAgents');
  it('--dry-run prints both plists and writes/loads nothing', async () => {
    expect(await runOpsCommand('install', ['--dry-run'], deps())).toBe(0);
    expect(out.join('\n')).toContain('com.gstudio.hal.nightly');
    expect(out.join('\n')).toContain('com.gstudio.hal.server');
    expect(calls).toEqual([]);
    expect(existsSync(agents())).toBe(false);
    expect(existsSync(join(repo, '.data'))).toBe(false);
  });
  it('install writes both plists to the injected dir and loads them; uninstall unloads and removes', async () => {
    await runOpsCommand('install', ['--at', '02:15'], deps());
    const n = join(agents(), 'com.gstudio.hal.nightly.plist');
    expect(await readFile(n, 'utf8')).toContain('<integer>2</integer>');
    expect(existsSync(join(agents(), 'com.gstudio.hal.server.plist'))).toBe(true);
    expect(calls.filter((c) => c[0] === 'load')).toHaveLength(2);
    calls.length = 0;
    await runOpsCommand('uninstall', [], deps());
    expect(existsSync(n)).toBe(false);
    expect(calls.filter((c) => c[0] === 'unload')).toHaveLength(2);
  });
  it('rejects a bad --at', async () => {
    await expect(runOpsCommand('install', ['--at', '25:00'], deps())).rejects.toThrow('HH:MM');
  });
});

describe('serve', () => {
  const listen = vi.fn(async (_o: unknown) => {});
  beforeEach(async () => { listen.mockClear(); await writeFile(join(repo, '.hal.env'), 'HAL_TOKEN=sekret-token\n'); });
  it('needs a token', async () => {
    await writeFile(join(repo, '.hal.env'), '');
    await expect(runOpsCommand('serve', [], deps({ listen }))).rejects.toThrow('setup');
  });
  it('binds 127.0.0.1 by default and 0.0.0.0 with --lan', async () => {
    await runOpsCommand('serve', [], deps({ listen }));
    expect(listen.mock.calls[0]![0]).toMatchObject({ hostname: '127.0.0.1', port: 5180 });
    await runOpsCommand('serve', ['--lan'], deps({ listen }));
    expect(listen.mock.calls[1]![0]).toMatchObject({ hostname: '0.0.0.0', port: 5180 });
  });
  it('prints the token URL only on a TTY without --quiet', async () => {
    await runOpsCommand('serve', ['--lan'], deps({ listen, isTTY: true }));
    expect(out.join('\n')).toContain('http://192.168.1.23:5180/?t=sekret-token');
    out.length = 0;
    await runOpsCommand('serve', ['--lan'], deps({ listen, isTTY: false }));
    await runOpsCommand('serve', ['--lan', '--quiet'], deps({ listen, isTTY: true }));
    expect(out.join('\n')).toContain('http://192.168.1.23:5180/');
    expect(out.join('\n')).not.toContain('sekret-token');
  });
});
