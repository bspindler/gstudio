// The result channel check-entry.ts writes with: nonce out of the env, intrinsics captured, taken once (R15/R17).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NONCE_ENV as CAND_NONCE_ENV, RESULT_PREFIX as CAND_PREFIX, parseResult, resolveTools } from './candidate.js';
import { captureChannel, NONCE_ENV, RESULT_PREFIX } from './check-nonce.js';

describe('check-nonce', () => {
  it('agrees with candidate.ts on the env name and prefix', () => {
    expect([NONCE_ENV, RESULT_PREFIX]).toEqual([CAND_NONCE_ENV, CAND_PREFIX]);
  });
  it('deletes the nonce from the env, writes with what it captured, and can be taken only once', () => {
    const env: NodeJS.ProcessEnv = { [NONCE_ENV]: 'n0nce', OTHER: 'x' };
    const written: string[] = [];
    const take = captureChannel(env, JSON.stringify.bind(JSON) as (v: unknown) => string, (s) => written.push(s));
    expect(env[NONCE_ENV]).toBeUndefined();
    expect(env.OTHER).toBe('x');
    const out = take();
    const orig = JSON.stringify;
    JSON.stringify = (() => '"forged"') as typeof JSON.stringify; // replaced after capture: no effect
    try { out({ a: 1 }); } finally { JSON.stringify = orig; }
    expect(parseResult(written.join(''), 'n0nce')).toEqual({ a: 1 });
    expect(() => take()).toThrow(/already taken/);
  });
  it('in a real child: game code loaded after the channel cannot see the nonce or redirect the result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hal-nonce-'));
    try {
      const script = join(dir, 'probe.mts');
      writeFileSync(script, `
        import { takeResultChannel } from ${JSON.stringify(join(import.meta.dirname, 'check-nonce.ts'))};
        const out = takeResultChannel();
        // "game code": tries everything cheap
        process.stderr.write('env:' + (process.env.${NONCE_ENV} ?? 'gone') + '\\n');
        JSON.stringify = () => '{"fitness":100}';
        process.stdout.write = (() => true) as typeof process.stdout.write;
        try { takeResultChannel(); process.stderr.write('second:TAKEN\\n'); } catch { process.stderr.write('second:refused\\n'); }
        out({ fitness: 42 });
      `);
      const t = resolveTools(join(import.meta.dirname, '..', '..'));
      const r = spawnSync(t.node, [t.tsx, script], { env: { ...process.env, [NONCE_ENV]: 'abc123' }, encoding: 'utf8' });
      expect(r.stderr).toContain('env:gone');
      expect(r.stderr).toContain('second:refused');
      expect(parseResult(r.stdout, 'abc123')).toEqual({ fitness: 42 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
