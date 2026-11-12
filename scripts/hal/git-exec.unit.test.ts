// The options every read-only git call from the report server (/shot, Play's "behind" line) and the History pages
// gets: the scrubbed env (no GIT_*, no secrets) and a timeout. execFile is mocked, so no git runs here.
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { cmd: string; args: string[]; opts: { env?: NodeJS.ProcessEnv; timeout?: number } };
const calls = vi.hoisted(() => [] as Call[]);
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>();
  const execFile = vi.fn((cmd: string, args: string[], opts: Call['opts'], cb: (e: Error | null, out: Buffer, err: Buffer) => void) => {
    calls.push({ cmd, args, opts });
    cb(null, Buffer.from(''), Buffer.from(''));
  });
  // promisify(execFile) resolves to { stdout, stderr }, as the real one does.
  Object.assign(execFile, {
    [promisify.custom]: (cmd: string, args: string[], opts: Call['opts']) => {
      calls.push({ cmd, args, opts });
      // One night folder with a note, so History also runs its per-night `git show`.
      const out = args.includes('ls-tree') && args.includes('-r') ? 'docs/hal/history/hyperline/2026-11-10/note.md\n' : '';
      return Promise.resolve({ stdout: Buffer.from(out), stderr: Buffer.from('') });
    },
  });
  return { ...real, execFile };
});

const { GIT_TIMEOUT_MS } = await import('./git.js');
const { realGit } = await import('./server.js');
const { readGameHistory, readHistoryImage } = await import('./history-git.js');

const saved = { ...process.env };
beforeEach(() => {
  calls.length = 0;
  process.env.GIT_DIR = '/elsewhere/.git';
  process.env.GIT_CONFIG_PARAMETERS = "'core.pager=evil'";
  process.env.HAL_TOKEN = 'secret-token';
  process.env.ANTHROPIC_API_KEY = 'sk-secret';
});
afterEach(() => { process.env = { ...saved }; });

const scrubbed = (c: Call) => {
  expect(c.opts.env, c.args.join(' ')).toBeDefined();
  for (const k of ['GIT_DIR', 'GIT_CONFIG_PARAMETERS', 'HAL_TOKEN', 'ANTHROPIC_API_KEY']) expect(c.opts.env![k], `${k} in ${c.args.join(' ')}`).toBeUndefined();
  expect(c.opts.env!.PATH).toBe(process.env.PATH);
};

describe('git calls from the server and History', () => {
  it('the timeout is the 10 s realGit has always used', () => {
    expect(GIT_TIMEOUT_MS).toBe(10_000);
  });
  it('final fix 6: realGit (/shot, Play) runs git with the scrubbed env and the timeout', async () => {
    await realGit('/repo')(['show', 'abc:docs/hal/history/g/2026-11-11/HAL-1-after.jpg']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('git');
    expect(calls[0]!.args.slice(0, 2)).toEqual(['-C', '/repo']);
    scrubbed(calls[0]!);
    expect(calls[0]!.opts.timeout).toBe(GIT_TIMEOUT_MS);
  });
  it('final fix 11: every git call History makes (log, ls-tree, show per night, config) has the timeout and the scrubbed env', async () => {
    await readGameHistory('/repo', 'hyperline', 0);
    await readHistoryImage('/repo', 'hyperline', '2026-11-10', 'HAL-001-before.jpg');
    expect(calls.some((c) => c.args.includes('show') && c.args.some((a) => a.endsWith('/2026-11-10/note.md')))).toBe(true);
    for (const c of calls) {
      scrubbed(c);
      expect(c.opts.timeout, c.args.join(' ')).toBe(GIT_TIMEOUT_MS);
    }
  });
});
