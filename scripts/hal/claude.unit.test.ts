import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { ALWAYS_DISALLOWED, SANDBOX_DENIED_ENV, implementerSandboxSettings, killLiveClaudeChildren, roleAllowedTools, roleTools, runClaude, runClaudeWithFallback, type ClaudeCall, type SpawnFn } from './claude.js';

const KEY = 'sk-ant-test-FAKE123';

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdinData = '';
  stdinEnded = false;
  stdin = { on: () => {}, end: (d?: string) => { this.stdinData += d ?? ''; this.stdinEnded = true; } };
  signals: string[] = [];
  kill(sig: string) { this.signals.push(sig); return true; }
}
type Script = (c: FakeChild) => void;
function fake(script: Script) {
  const calls: { cmd: string; args: string[]; opts: any; child: FakeChild }[] = [];
  const spawn: SpawnFn = (cmd, args, opts) => {
    const child = new FakeChild();
    calls.push({ cmd, args, opts, child });
    queueMicrotask(() => script(child));
    return child as any;
  };
  return { spawn, calls };
}
const finish = (out: string, code = 0, err = '') => (c: FakeChild) => {
  if (out) c.stdout.emit('data', Buffer.from(out));
  if (err) c.stderr.emit('data', Buffer.from(err));
  c.emit('close', code, null);
};
const json = (o: object) => JSON.stringify(o) + '\n';
const base: ClaudeCall = {
  role: 'implementer', prompt: 'do it', cwd: '/repo', billing: 'subscription', maxBudgetUsd: 1.5, model: 'claude-haiku-5-5',
  allowedTools: roleAllowedTools('implementer'), disallowedTools: [], timeoutMs: 60_000, denyReadPaths: ['/main/.hal.env'],
};
const baseEnv = { PATH: '/bin', ANTHROPIC_API_KEY: 'leaked-from-parent', ANTHROPIC_AUTH_TOKEN: 'tok' };
const deps = (spawn: SpawnFn, extra = {}) => ({ spawn, env: baseEnv, now: () => 0, apiKey: KEY, ...extra });
const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('runClaude', () => {
  it('success: parses last JSON object, cost, ok', async () => {
    const f = fake(finish('noise\n' + json({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.0123 })));
    const r = await runClaude(base, deps(f.spawn));
    expect(r).toMatchObject({ ok: true, text: 'ok', costUsd: 0.0123, subtype: 'success', limitHit: false, timedOut: false });
  });
  it('is_error is not ok', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: true, result: 'boom', total_cost_usd: 0.1 })));
    const r = await runClaude(base, deps(f.spawn));
    expect(r.ok).toBe(false);
    expect(r.costUsd).toBe(0.1);
  });
  it('budget exceeded subtype', async () => {
    const f = fake(finish(json({ subtype: 'error_max_budget_usd', is_error: false, total_cost_usd: 1.6 })));
    const r = await runClaude(base, deps(f.spawn));
    expect(r).toMatchObject({ ok: false, subtype: 'error_max_budget_usd', costUsd: 1.6 });
  });
  it('missing cost is null', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: false, result: 'x' })));
    expect((await runClaude(base, deps(f.spawn))).costUsd).toBeNull();
  });
  it('no JSON on stdout', async () => {
    const f = fake(finish('not json at all', 0, 'some stderr'));
    const r = await runClaude(base, deps(f.spawn));
    expect(r).toMatchObject({ ok: false, subtype: 'no_json', costUsd: null, text: 'not json at all' });
    expect(r.stderrTail).toContain('some stderr');
  });
  it('non-zero exit with JSON still not ok', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: false, result: 'x' }), 1, 'bad'));
    const r = await runClaude(base, deps(f.spawn));
    expect(r.ok).toBe(false);
    expect(r.subtype).toBe('success');
  });
  it('non-zero exit, no JSON', async () => {
    const f = fake(finish('', 2, 'fatal'));
    const r = await runClaude(base, deps(f.spawn));
    expect(r).toMatchObject({ ok: false, subtype: 'exit_2' });
  });
  it('limit text in result sets limitHit', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: true, result: "You've hit your session limit · resets 3pm" })));
    expect((await runClaude(base, deps(f.spawn))).limitHit).toBe(true);
  });
  it('limit text in stderr sets limitHit', async () => {
    const f = fake(finish('', 1, 'Claude usage limit reached. Your limit will reset at 5pm'));
    expect((await runClaude(base, deps(f.spawn))).limitHit).toBe(true);
  });
  it('an ok result mentioning a limit is not limitHit', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: false, result: 'docs say: usage limit reached', total_cost_usd: 0.1 })));
    const r = await runClaude(base, deps(f.spawn));
    expect(r).toMatchObject({ ok: true, limitHit: false });
  });
  it('ordinary text is not a limit', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: false, result: 'we should limit scope' })));
    expect((await runClaude(base, deps(f.spawn))).limitHit).toBe(false);
  });
  it('zero budget does not spawn', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: false })));
    const r = await runClaude({ ...base, maxBudgetUsd: 0 }, deps(f.spawn));
    expect(r).toMatchObject({ ok: false, subtype: 'no_budget' });
    expect(f.calls).toHaveLength(0);
  });
  it('implementer without denyReadPaths (missing or empty) does not spawn: no_deny_paths', async () => {
    for (const denyReadPaths of [undefined, []]) {
      for (const billing of ['api', 'subscription'] as const) {
        const f = fake(finish(json({ subtype: 'success', is_error: false })));
        const r = await runClaude({ ...base, billing, denyReadPaths }, deps(f.spawn));
        expect(r).toMatchObject({ ok: false, subtype: 'no_deny_paths', costUsd: null });
        expect(f.calls).toHaveLength(0);
      }
    }
  });
  it('planner/director need no denyReadPaths', async () => {
    for (const role of ['planner', 'director'] as const) {
      const f = fake(finish(json({ subtype: 'success', is_error: false, result: 'x' })));
      const r = await runClaude({ ...base, role, allowedTools: roleAllowedTools(role), denyReadPaths: undefined }, deps(f.spawn));
      expect(r.ok).toBe(true);
      expect(f.calls).toHaveLength(1);
    }
  });
  it('spawn error event resolves, not throws', async () => {
    const f = fake((c) => c.emit('error', new Error('spawn claude ENOENT')));
    const r = await runClaude(base, deps(f.spawn));
    expect(r).toMatchObject({ ok: false, subtype: 'spawn_error' });
    expect(r.stderrTail).toContain('ENOENT');
  });

  describe('timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it('SIGTERM to the process group, SIGKILL 10s later, timedOut', async () => {
      const kills: [number, string][] = [];
      const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: string) => { kills.push([pid, sig]); return true; }) as any);
      const f = fake(() => { /* hangs */ });
      const p = runClaude({ ...base, timeoutMs: 1000 }, deps(f.spawn));
      await vi.advanceTimersByTimeAsync(1000);
      expect(kills).toEqual([[-4242, 'SIGTERM']]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(kills).toEqual([[-4242, 'SIGTERM'], [-4242, 'SIGKILL']]);
      f.calls[0]!.child.emit('close', null, 'SIGKILL');
      const r = await p;
      expect(r).toMatchObject({ ok: false, timedOut: true, subtype: 'timeout' });
      kill.mockRestore();
    });
    it('resolves after SIGKILL even if close never fires', async () => {
      const kill = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
      const f = fake(() => {});
      const p = runClaude({ ...base, timeoutMs: 1000 }, deps(f.spawn));
      await vi.advanceTimersByTimeAsync(1000 + 10_000 + 2_000);
      await expect(p).resolves.toMatchObject({ timedOut: true, subtype: 'timeout' });
      kill.mockRestore();
    });
    it('killLiveClaudeChildren SIGKILLs live groups and forgets finished ones', async () => {
      const kills: [number, string][] = [];
      const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: string) => { kills.push([pid, sig]); return true; }) as any);
      const f = fake(() => {});
      const p = runClaude({ ...base, timeoutMs: 600_000 }, deps(f.spawn));
      await vi.advanceTimersByTimeAsync(0);
      killLiveClaudeChildren();
      expect(kills).toEqual([[-4242, 'SIGKILL']]);
      f.calls[0]!.child.emit('close', null, 'SIGKILL');
      await p;
      kills.length = 0;
      killLiveClaudeChildren();
      expect(kills).toEqual([]);
      kill.mockRestore();
    });
    it('does not SIGKILL when the child exits after SIGTERM', async () => {
      const kills: [number, string][] = [];
      const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: string) => { kills.push([pid, sig]); return true; }) as any);
      const f = fake(() => {});
      const p = runClaude({ ...base, timeoutMs: 1000 }, deps(f.spawn));
      await vi.advanceTimersByTimeAsync(1000);
      f.calls[0]!.child.emit('close', null, 'SIGTERM');
      await p;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(kills).toEqual([[-4242, 'SIGTERM']]);
      kill.mockRestore();
    });
  });

  describe('spawn arguments and env', () => {
    const ok = () => fake(finish(json({ subtype: 'success', is_error: false, result: 'x', total_cost_usd: 0 })));
    it('subscription: no key in env, strict-mcp, project settings, no bare, argv + detached, no shell', async () => {
      const f = ok();
      await runClaude({ ...base, role: 'director', allowedTools: [] }, deps(f.spawn));
      const { cmd, args, opts } = f.calls[0]!;
      expect(cmd).toBe('claude');
      expect(opts.detached).toBe(true);
      expect(opts.shell).toBeFalsy();
      expect(opts.cwd).toBe('/repo');
      expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(opts.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(opts.env.PATH).toBe('/bin');
      expect(baseEnv.ANTHROPIC_API_KEY).toBe('leaked-from-parent');
      expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config']));
      expect(args).not.toContain('--permission-mode'); // director: default mode
      expect(arg(args, '--tools')).toBe('');
      expect(arg(args, '--max-budget-usd')).toBe('1.5');
      expect(arg(args, '--model')).toBe('claude-haiku-5-5');
      expect(arg(args, '--setting-sources')).toBe('project');
      expect(args).not.toContain('--bare');
      expect(args).not.toContain('--allowedTools'); // director: none
      expect(args).not.toContain('do it'); // prompt is on stdin
      expect(f.calls[0]!.child.stdinData).toBe('do it');
      expect(f.calls[0]!.child.stdinEnded).toBe(true);
    });
    it('api: key in env, --bare, no strict-mcp / setting-sources, append system prompt file', async () => {
      const f = ok();
      await runClaude({ ...base, billing: 'api', appendSystemPromptFile: '/repo/CLAUDE.md' }, deps(f.spawn));
      const { args, opts } = f.calls[0]!;
      expect(opts.env.ANTHROPIC_API_KEY).toBe(KEY);
      expect(opts.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(args).toContain('--bare');
      expect(args).not.toContain('--strict-mcp-config');
      expect(arg(args, '--setting-sources')).toBe('project');
      expect(arg(args, '--disallowedTools')!.split(',')).toEqual(expect.arrayContaining(ALWAYS_DISALLOWED));
      expect(arg(args, '--append-system-prompt-file')).toBe('/repo/CLAUDE.md');
      expect(args.join(' ')).not.toContain(KEY);
    });
    for (const role of ['planner', 'implementer', 'director'] as const) {
      for (const billing of ['api', 'subscription'] as const) {
        it(`argv for ${role} + ${billing}`, async () => {
          const f = ok();
          await runClaude({ ...base, role, billing, allowedTools: roleAllowedTools(role) }, deps(f.spawn));
          const { args } = f.calls[0]!;
          expect(arg(args, '--tools')).toBe({ planner: 'Read,Glob,Grep', implementer: 'Read,Edit,Write,Glob,Grep,Bash', director: '' }[role]);
          expect(roleTools(role)).toBe(arg(args, '--tools'));
          if (role === 'implementer') expect(arg(args, '--permission-mode')).toBe('acceptEdits');
          else expect(args).not.toContain('--permission-mode');
          expect(args.includes('--bare')).toBe(billing === 'api');
          expect(args.includes('--strict-mcp-config')).toBe(billing === 'subscription');
          expect(arg(args, '--setting-sources')).toBe('project');
          expect(arg(args, '--disallowedTools')!.split(',')).toEqual(expect.arrayContaining(ALWAYS_DISALLOWED));
          expect(args).not.toContain('do it');
        });
      }
    }
    for (const role of ['planner', 'implementer', 'director'] as const) {
      for (const billing of ['api', 'subscription'] as const) {
        it(`sandbox settings only for the implementer (${role} + ${billing}); HAL_TOKEN never reaches the child`, async () => {
          const f = ok();
          const env = { ...baseEnv, HAL_TOKEN: 'dash-token' };
          await runClaude({ ...base, role, billing, allowedTools: roleAllowedTools(role), denyReadPaths: ['/main/.hal.env'] }, deps(f.spawn, { env }));
          const { args, opts } = f.calls[0]!;
          expect(opts.env.HAL_TOKEN).toBeUndefined();
          expect(env.HAL_TOKEN).toBe('dash-token'); // caller's env untouched
          if (role !== 'implementer') return expect(args).not.toContain('--settings');
          expect(args.filter((a) => a === '--settings')).toHaveLength(1);
          expect(JSON.parse(arg(args, '--settings')!)).toEqual(implementerSandboxSettings({ cwd: '/repo', denyReadPaths: ['/main/.hal.env'] }));
          expect(arg(args, '--setting-sources')).toBe('project'); // flag settings still apply alongside it
        });
      }
    }
    it('implementer sandbox settings: enforced, fail-closed, no network, .hal.env unreadable, writes in cwd + tmp only', () => {
      expect(implementerSandboxSettings({ cwd: '/wt', denyReadPaths: ['/main/.hal.env', '/wt/.hal.env'] })).toEqual({
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          autoAllowBashIfSandboxed: false,
          excludedCommands: [],
          network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: true },
          filesystem: { denyRead: ['/wt/.hal.env', '/main/.hal.env'], allowWrite: ['/wt', tmpdir()] },
          credentials: { envVars: [
            { name: 'ANTHROPIC_API_KEY', mode: 'deny' }, { name: 'ANTHROPIC_AUTH_TOKEN', mode: 'deny' }, { name: 'HAL_TOKEN', mode: 'deny' },
          ] },
        },
      });
      expect(SANDBOX_DENIED_ENV).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'HAL_TOKEN']);
    });
    it('without denyReadPaths the cwd .hal.env is still denied', () => {
      const s = implementerSandboxSettings({ cwd: '/wt' }) as { sandbox: { filesystem: { denyRead: string[] } } };
      expect(s.sandbox.filesystem.denyRead).toEqual(['/wt/.hal.env']);
    });
    it('the api key never appears in the sandbox settings argv', async () => {
      const f = ok();
      await runClaude({ ...base, billing: 'api' }, deps(f.spawn));
      expect(arg(f.calls[0]!.args, '--settings')).not.toContain(KEY);
    });
    it('.hal.env is denied for Read/Edit/Write/Grep in all path forms', () => {
      for (const t of ['Read', 'Edit', 'Write', 'Grep']) {
        for (const form of ['.hal.env', './.hal.env', '**/.hal.env']) expect(ALWAYS_DISALLOWED).toContain(`${t}(${form})`);
      }
    });
    it('tool lists are single comma-joined args so the variadic flag cannot swallow the prompt', async () => {
      const f = ok();
      await runClaude({ ...base, prompt: '--weird prompt', disallowedTools: ['Bash(rm:*)'] }, deps(f.spawn));
      const { args } = f.calls[0]!;
      const allowed = arg(args, '--allowedTools')!;
      expect(allowed.split(',')).toEqual(roleAllowedTools('implementer'));
      const denied = arg(args, '--disallowedTools')!.split(',');
      for (const d of ALWAYS_DISALLOWED) expect(denied).toContain(d);
      expect(denied).toContain('Bash(rm:*)');
      expect(f.calls[0]!.child.stdinData).toBe('--weird prompt');
      expect(args).not.toContain('--weird prompt');
    });
    it('api call with no key throws without leaking anything', async () => {
      const f = ok();
      await expect(runClaude({ ...base, billing: 'api' }, deps(f.spawn, { apiKey: undefined }))).rejects.toThrow('no API key');
      expect(f.calls).toHaveLength(0);
    });
  });

  describe('role tools (ruling R2)', () => {
    it('planner is read-only', () => expect(roleAllowedTools('planner')).toEqual(['Read', 'Glob', 'Grep']));
    it('director has none', () => expect(roleAllowedTools('director')).toEqual([]));
    it('implementer has npm test, no vitest/npx', () => {
      const t = roleAllowedTools('implementer');
      expect(t).toEqual(['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(npm run typecheck)', 'Bash(npm run hal -- score:*)']);
      expect(t.join(' ')).not.toMatch(/npx|vitest/);
    });
    it('always-disallowed list', () => {
      expect(ALWAYS_DISALLOWED.slice(0, 10)).toEqual(['WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git remote:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(npx:*)', 'Bash(gh:*)']);
    });
  });

  describe('key never leaks', () => {
    it('redacts key from text and stderrTail (incl. error result)', async () => {
      const f = fake(finish(json({ subtype: 'success', is_error: true, result: `auth failed for ${KEY}!` }), 1, `x-api-key: ${KEY}\n${KEY}`));
      const r = await runClaude({ ...base, billing: 'api' }, deps(f.spawn));
      expect(JSON.stringify(r)).not.toContain(KEY);
      expect(r.text).toContain('[REDACTED]');
      expect(r.stderrTail).toContain('[REDACTED]');
    });
    it('redacts key in non-JSON stdout and spawn errors', async () => {
      const a = await runClaude({ ...base, billing: 'api' }, deps(fake(finish(`raw ${KEY}`)).spawn));
      expect(JSON.stringify(a)).not.toContain(KEY);
      const b = await runClaude({ ...base, billing: 'api' }, deps(fake((c) => c.emit('error', new Error(`bad ${KEY}`))).spawn));
      expect(JSON.stringify(b)).not.toContain(KEY);
    });
    it('key split across stderr chunks is still redacted', async () => {
      const f = fake((c) => { c.stderr.emit('data', Buffer.from(KEY.slice(0, 8))); c.stderr.emit('data', Buffer.from(KEY.slice(8))); c.emit('close', 1, null); });
      const r = await runClaude({ ...base, billing: 'api' }, deps(f.spawn));
      expect(r.stderrTail).not.toContain(KEY);
    });
    it('stderrTail is bounded', async () => {
      const f = fake(finish('', 1, 'e'.repeat(100_000)));
      expect((await runClaude(base, deps(f.spawn))).stderrTail.length).toBeLessThanOrEqual(4000);
    });
  });
});

describe('runClaudeWithFallback', () => {
  const okOut = json({ subtype: 'success', is_error: false, result: 'fine', total_cost_usd: 0.2 });
  const limitOut = json({ subtype: 'success', is_error: true, result: "You've hit your limit" });
  it('no retry when the subscription call succeeds', async () => {
    const f = fake(finish(okOut));
    const r = await runClaudeWithFallback(base, deps(f.spawn));
    expect(r.retry).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });
  it('does not retry an ok result whose text mentions a limit', async () => {
    const f = fake(finish(json({ subtype: 'success', is_error: false, result: 'usage limit reached', total_cost_usd: 0.1 })));
    const r = await runClaudeWithFallback(base, deps(f.spawn));
    expect(r.retry).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });
  it('a throwing retry (no key) keeps first and reports retry_error', async () => {
    const f = fake(finish(limitOut));
    const r = await runClaudeWithFallback(base, deps(f.spawn, { apiKey: undefined }));
    expect(r.first.limitHit).toBe(true);
    expect(r.retry).toMatchObject({ ok: false, subtype: 'retry_error' });
    expect(f.calls).toHaveLength(1);
  });
  it('retries once with api billing and a fresh slice on limitHit', async () => {
    let n = 0;
    const f = fake((c) => finish(n++ === 0 ? limitOut : okOut)(c));
    const r = await runClaudeWithFallback(base, deps(f.spawn), 0.75);
    expect(f.calls).toHaveLength(2);
    expect(r.first.limitHit).toBe(true);
    expect(r.retry!.ok).toBe(true);
    const second = f.calls[1]!;
    expect(second.args).toContain('--bare');
    expect(second.opts.env.ANTHROPIC_API_KEY).toBe(KEY);
    expect(arg(second.args, '--max-budget-usd')).toBe('0.75');
  });
  it('never retries an api call', async () => {
    const f = fake(finish(limitOut));
    const r = await runClaudeWithFallback({ ...base, billing: 'api' }, deps(f.spawn));
    expect(r.retry).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });
});
