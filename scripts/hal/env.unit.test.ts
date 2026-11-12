import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { childEnv, loadHalEnv, parseHalEnv, secretReadPaths } from './env.js';

describe('parseHalEnv', () => {
  it('parses KEY=VALUE, comments, blanks, quotes, no interpolation', () => {
    const r = parseHalEnv(`# c\n\nA=1\nexport B = two words \nC="q # x"\nD='$A'\nE=\${A}\nF=\n  # indented\n`);
    expect(r).toEqual({ A: '1', B: 'two words', C: 'q # x', D: '$A', E: '${A}', F: '' });
  });
  it('handles CRLF', () => {
    expect(parseHalEnv('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
  it('throws with the line number and never the value', () => {
    let msg = '';
    try { parseHalEnv('A=1\nsk-ant-test-FAKE\n'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('line 2');
    expect(msg).not.toContain('sk-ant-test-FAKE');
    expect(() => parseHalEnv('=v')).toThrow(/line 1/);
    expect(() => parseHalEnv('1BAD=v')).toThrow(/line 1/);
    expect(() => parseHalEnv('A="unterminated')).toThrow(/line 1/);
  });
});

describe('loadHalEnv', () => {
  it('returns {} when missing', async () => {
    expect(loadHalEnv(await mkdtemp(join(tmpdir(), 'hal-env-')))).toEqual({});
  });
  it('reads .hal.env from the repo', async () => {
    const d = await mkdtemp(join(tmpdir(), 'hal-env-'));
    await writeFile(join(d, '.hal.env'), 'ANTHROPIC_API_KEY=sk-ant-test-FAKE\n');
    expect(loadHalEnv(d)).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test-FAKE' });
  });
});

describe('childEnv', () => {
  const base = { PATH: '/bin', ANTHROPIC_API_KEY: 'old', ANTHROPIC_AUTH_TOKEN: 'tok' } as NodeJS.ProcessEnv;
  it('api sets the key and keeps the rest', () => {
    const e = childEnv(base, 'api', 'sk-ant-test-FAKE');
    expect(e.ANTHROPIC_API_KEY).toBe('sk-ant-test-FAKE');
    expect(e.PATH).toBe('/bin');
  });
  it('api also drops an inherited ANTHROPIC_AUTH_TOKEN', () => {
    const e = childEnv(base, 'api', 'k');
    expect('ANTHROPIC_AUTH_TOKEN' in e).toBe(false);
    expect(e.ANTHROPIC_API_KEY).toBe('k');
  });
  it('api without a key throws', () => {
    expect(() => childEnv({ PATH: '/bin' }, 'api')).toThrow('no API key in .hal.env');
    expect(() => childEnv({ PATH: '/bin' }, 'api', '')).toThrow('no API key in .hal.env');
  });
  it('subscription deletes both vars', () => {
    const e = childEnv(base, 'subscription', 'ignored');
    expect('ANTHROPIC_API_KEY' in e).toBe(false);
    expect('ANTHROPIC_AUTH_TOKEN' in e).toBe(false);
    expect(e.PATH).toBe('/bin');
  });
  it('never mutates base', () => {
    childEnv(base, 'subscription');
    childEnv(base, 'api', 'k');
    expect(base).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'old', ANTHROPIC_AUTH_TOKEN: 'tok' });
  });
});

describe('secretReadPaths', () => {
  it('is <repo>/.hal.env, then the home credentials and shell profiles', () => {
    const p = secretReadPaths('/r', '/h');
    expect(p[0]).toBe('/r/.hal.env');
    for (const n of ['.ssh', '.aws', '.azure', '.config/gh', '.npmrc', '.zshrc', '.zprofile', '.claude', 'Library/Keychains']) expect(p).toContain(`/h/${n}`);
    expect(p.every((x) => x.startsWith('/') && !/[\s,()]/.test(x))).toBe(true); // safe as --disallowedTools rule paths
  });
});
