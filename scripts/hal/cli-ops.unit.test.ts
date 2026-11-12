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
  halDir: join(repo, '.data/hal'), games: ['tidepool-pals'], repo, execPath: '/opt/node & co/bin/node', home, which: () => '/Users/zed/.local/share/claude/bin/claude',
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
  it('replaces an empty HAL_TOKEN= line instead of duplicating it, leaving other lines alone', async () => {
    await writeFile(join(repo, '.hal.env'), 'A=1\nHAL_TOKEN=\n\nANTHROPIC_API_KEY=sk-secret\n');
    await runOpsCommand('setup', [], deps());
    const t = await readFile(join(repo, '.hal.env'), 'utf8');
    expect(t).toMatch(/^A=1\nHAL_TOKEN=[A-Za-z0-9_-]{43}\n\nANTHROPIC_API_KEY=sk-secret\n$/);
    expect(t.match(/HAL_TOKEN/g)).toHaveLength(1);
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
  const o = { execPath: '/opt/node & co/bin/node', repo: '/Users/a<b>/repo', halDir: '/Users/a<b>/repo/.data/hal', home: '/Users/a<b>', claudeDir: '/Users/a<b>/.local/share/claude/bin' };
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

describe('launchd PATH', () => {
  it('has node dir, claude dir, user/homebrew bins, system dirs, no duplicates', () => {
    const x = nightlyPlist({ execPath: '/opt/homebrew/bin/node', repo: '/r', halDir: '/r/.data/hal', home: '/Users/q', claudeDir: '/Users/q/.local/bin' });
    expect(x).toContain('<string>/opt/homebrew/bin:/Users/q/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>');
    const y = serverPlist({ execPath: '/n/bin/node', repo: '/r', halDir: '/r/.data/hal', home: '/Users/q', claudeDir: '/c/bin' });
    expect(y).toContain('<string>/n/bin:/c/bin:/Users/q/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>');
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
  it('install pre-creates the launchd log files 0600 in a 0700 dir; dry-run creates none', async () => {
    await runOpsCommand('install', [], deps());
    const logs = join(repo, '.data/hal/logs');
    expect((await stat(join(logs, 'nightly.log'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(logs, 'server.log'))).mode & 0o777).toBe(0o600);
    expect((await stat(logs)).mode & 0o777).toBe(0o700);
  });
  it('install fails clearly without claude; dry-run warns and still prints', async () => {
    await expect(runOpsCommand('install', [], deps({ which: () => null }))).rejects.toThrow('claude not found');
    expect(calls).toEqual([]);
    expect(existsSync(agents())).toBe(false);
    expect(await runOpsCommand('install', ['--dry-run'], deps({ which: () => null }))).toBe(0);
    expect(out.join('\n')).toContain('WARNING: claude not found');
  });
  it('install puts the claude dir in the PATH', async () => {
    await runOpsCommand('install', [], deps());
    expect(await readFile(join(agents(), 'com.gstudio.hal.server.plist'), 'utf8')).toContain('/Users/zed/.local/share/claude/bin');
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

describe('TSX_DISABLE_CACHE (fix round 3)', () => {
  const o = { execPath: '/n', repo: '/r', halDir: '/r/.data/hal', home: '/h', claudeDir: '/c' };
  it('both plists set TSX_DISABLE_CACHE=1, so launchd never runs Hal with tsx\'s shared-tmp cache', () => {
    for (const x of [nightlyPlist(o), serverPlist(o)]) expect(x).toMatch(/<key>TSX_DISABLE_CACHE<\/key>\s*<string>1<\/string>/);
  });
  it('scripts/hal.ts warns a hand-started run/undo without it (npm scripts must stay Windows-safe)', async () => {
    const src = await readFile(new URL('../hal.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/TSX_DISABLE_CACHE !== '1'/);
  });
});
