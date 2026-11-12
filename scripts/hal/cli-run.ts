// CLI commands for the run itself: run, stop, undo. cli.ts only dispatches here. The real deps (Claude, the sandboxed
// play checks, ci:local) are wired in realRunDeps; the API key goes only into the Claude adapter's deps.
//   npm run hal -- run [--nightly] [--billing api|subscription] [--game g]... [--kind k]... [--report-only]
//                      [--max-tickets n] [--no-push]
//   npm run hal -- stop
//   npm run hal -- undo HAL-0xx --reason "<text>" [--no-push]
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Billing, ScoreReport, TicketKind } from '@studio/core/hal';
import { CHECK_TIMEOUT_MS, defaultCommands, resolveTools } from './candidate.js';
import { runClaude, runClaudeWithFallback, type ClaudeDeps } from './claude.js';
import type { ControlCheck } from './controls.js';
import { childEnv, loadHalEnv } from './env.js';
import { runNight, STOP_FILE, undoCommand, type CiLocal, type PlayPort, type RunDeps, type RunOptions } from './run.js';
import { entryCheck, errMsg, redactor, tail } from './run-util.js';
import type { ScreensResult } from './screens.js';

export const RUN_COMMANDS = ['run', 'stop', 'undo'] as const;
export type RunCommand = (typeof RUN_COMMANDS)[number];
export const isRunCommand = (c: string | undefined): c is RunCommand => !!c && (RUN_COMMANDS as readonly string[]).includes(c);

export const DEFAULT_MAX_TICKETS = 6;
export const DEFAULT_MODEL = 'opus';
export const CI_LOCAL_TIMEOUT_MS = 90 * 60_000;
const KINDS: readonly TicketKind[] = ['fix', 'tuning', 'polish', 'feature'];

export type RunCmdDeps = {
  halDir: string;
  /** Game slugs in scope by default (not scorer names). */
  games: string[];
  repo?: string;
  now?: () => Date;
  /** Tests: the deps for run/undo. Default realRunDeps(repo, halDir). */
  makeDeps?: () => RunDeps;
};

const defaultRepo = () => fileURLToPath(new URL('../../', import.meta.url));

/** Throws an Error with the message to show (cli.ts makes that exit 1). */
export function parseRunArgs(rest: string[], games: string[]): RunOptions {
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      nightly: { type: 'boolean' }, billing: { type: 'string' }, game: { type: 'string', multiple: true }, kind: { type: 'string', multiple: true },
      'report-only': { type: 'boolean' }, 'max-tickets': { type: 'string' }, 'no-push': { type: 'boolean' },
    },
  });
  if (positionals.length) throw new Error(`run takes no positional arguments (got ${positionals.join(' ')})`);
  const nightly = values.nightly === true;
  let billing: Billing = nightly ? 'api' : 'subscription';
  if (values.billing !== undefined) {
    if (values.billing !== 'api' && values.billing !== 'subscription') throw new Error('--billing must be api or subscription');
    billing = values.billing;
  }
  const sel = [...new Set(values.game ?? [])];
  for (const g of sel) if (!games.includes(g)) throw new Error(`unknown game ${g}; known: ${games.join(', ')}`);
  const kinds = [...new Set(values.kind ?? [])];
  for (const k of kinds) if (!KINDS.includes(k as TicketKind)) throw new Error(`unknown kind ${k}; --kind is one of ${KINDS.join(', ')}`);
  let maxTickets = DEFAULT_MAX_TICKETS;
  if (values['max-tickets'] !== undefined) {
    maxTickets = Number(values['max-tickets']);
    if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 8) throw new Error('--max-tickets must be an integer from 1 to 8');
  }
  return {
    games: sel.length ? sel : [...games], kinds: kinds as TicketKind[], reportOnly: values['report-only'] === true, maxTickets,
    trigger: nightly ? 'nightly' : 'manual', billing, push: values['no-push'] !== true,
  };
}

export async function runRunCommand(c: RunCommand, rest: string[], d: RunCmdDeps): Promise<number> {
  const repo = d.repo ?? defaultRepo();
  if (c === 'stop') {
    parseArgs({ args: rest, options: {} });
    await mkdir(d.halDir, { recursive: true });
    await writeFile(join(d.halDir, STOP_FILE), (d.now ?? (() => new Date()))().toISOString());
    console.log('stop requested: the run finishes its current step, skips the remaining candidates, and still writes the note and report');
    return 0;
  }
  if (c === 'run') {
    const o = parseRunArgs(rest, d.games);
    return runNight(o, (d.makeDeps ?? (() => realRunDeps(repo, d.halDir)))());
  }
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { reason: { type: 'string' }, 'no-push': { type: 'boolean' } } });
  const pass = positionals[0];
  if (!pass || positionals.length > 1 || !/^HAL-\d+$/.test(pass)) throw new Error('usage: hal undo HAL-0xx --reason "<text>" [--no-push]');
  const reason = (values.reason ?? '').trim();
  if (!reason) throw new Error('undo needs --reason "<why>" (it is recorded for the next planner)');
  return undoCommand(pass, reason, { push: values['no-push'] !== true }, (d.makeDeps ?? (() => realRunDeps(repo, d.halDir)))());
}

/** The real wiring. The key stays in claudeDeps (never process.env); everything else gets only the redaction list. */
export function realRunDeps(repo: string, halDir: string): RunDeps {
  const env = loadHalEnv(repo);
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const secrets = [apiKey, env.HAL_TOKEN?.trim()].filter((s): s is string => !!s);
  const claudeDeps: ClaudeDeps = { spawn: (cmd, args, o) => spawn(cmd, args, o), env: process.env, now: Date.now, ...(apiKey ? { apiKey } : {}) };
  return {
    repo, halDir, now: () => new Date(), model: env.HAL_MODEL?.trim() || DEFAULT_MODEL, secrets, hasApiKey: !!apiKey,
    // Without a key there is nothing to fall back to: a limit hit switches the run to API, which then stops cleanly.
    claude: apiKey ? (call, s) => runClaudeWithFallback(call, claudeDeps, s) : async (call) => ({ first: await runClaude(call, claudeDeps) }),
    play: realPlay(repo, secrets),
    ciLocal: realCiLocal(repo, secrets),
  };
}

/**
 * Main's own checks: scripts/hal/check-entry.ts in Hal's main worktree, with Hal's tools from <repo>/node_modules,
 * through entryCheck (node_modules relinked and verified, sandboxed, writes to tmp only, nonce'd result).
 */
export function realPlay(repo: string, secrets: string[]): PlayPort {
  const cmds = () => defaultCommands(resolveTools(repo), {});
  const run = <T>(argv: string[], dir: string) => entryCheck<T>(argv, { cwd: dir, repo, secrets, writable: [], timeoutMs: CHECK_TIMEOUT_MS });
  return {
    score: (dir, scorer) => run<ScoreReport<unknown>>(cmds().score(dir, scorer), dir),
    async screens(dir, game, outDir) {
      const r = await run<ScreensResult>(cmds().screens(dir, game), dir);
      await mkdir(outDir, { recursive: true });
      const shots: string[] = [];
      for (const s of r.shots ?? []) {
        const to = join(outDir, basename(s));
        try { await copyFile(s, to); shots.push(to); } catch { /* a shot that is gone is just not listed */ }
      }
      return { ...r, shots };
    },
    controls: (dir, game) => run<ControlCheck[]>(cmds().controls(dir, game), dir),
  };
}

/** `npm run ci:local -- <sha>` in Brian's checkout with the secrets scrubbed from its env; the verdict is .data/ci/<sha>.json. */
export function realCiLocal(repo: string, secrets: string[]): CiLocal {
  const { str } = redactor(secrets);
  return (sha) => new Promise((resolve) => {
    const env = childEnv(process.env, 'subscription');
    for (const k of Object.keys(env)) {
      const v = env[k];
      if (/^(?:HAL_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)$/.test(k) || (v !== undefined && secrets.some((s) => v.includes(s)))) delete env[k];
    }
    let out = '';
    const child = spawn('npm', ['run', 'ci:local', '--', sha], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), CI_LOCAL_TIMEOUT_MS);
    child.stdout.on('data', (b: Buffer) => { out = (out + b.toString()).slice(-20_000); });
    child.stderr.on('data', (b: Buffer) => { out = (out + b.toString()).slice(-20_000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, detail: str(errMsg(e)) }); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(await readFile(join(repo, '.data', 'ci', `${sha}.json`), 'utf8')) as { ok?: boolean; steps?: { step: string; ok: boolean }[] };
        const failed = (r.steps ?? []).filter((s) => !s.ok).map((s) => s.step);
        resolve({ ok: r.ok === true && code === 0, detail: r.ok === true ? 'passed' : `failed: ${failed.join(', ') || `exit ${code}`}` });
      } catch {
        resolve({ ok: false, detail: str(`no result (exit ${code}): ${tail(out, 600)}`) });
      }
    });
  });
}
