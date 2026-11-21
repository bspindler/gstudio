// CLI commands for the run itself: run, stop, undo. cli.ts only dispatches here. The real deps (Claude, the sandboxed
// play checks, ci:local) are wired in realRunDeps; the API key goes only into the Claude adapter's deps.
//   npm run hal -- run [--nightly] [--billing api|subscription] [--game g]... [--kind k]... [--report-only]
//                      [--max-tickets n] [--no-push]
//   npm run hal -- stop
//   npm run hal -- undo HAL-0xx --reason "<text>" [--no-push]
import { spawn } from 'node:child_process';
import { ciLocalSandboxed } from './ci-sandboxed.js';
import { existsSync, lstatSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Billing, ScoreReport, TicketKind } from '@studio/core/hal';
import { CHECK_TIMEOUT_MS, defaultCommands, resolveTools } from './candidate.js';
import { runClaude, type ClaudeDeps } from './claude.js';
import type { ControlCheck } from './controls.js';
import { loadHalEnv } from './env.js';
import { runSeries, seriesStopReason, takeTimes } from './series.js';
import { runNight, STOP_FILE, heldCommand, shipPendingCommand, undoCommand, type CiLocal, type PlayPort, type RunDeps, type RunOptions } from './run.js';
import { entryCheck } from './run-util.js';
import type { ScreensResult } from './screens.js';

export const RUN_COMMANDS = ['run', 'stop', 'undo', 'ship', 'drop'] as const;
export type RunCommand = (typeof RUN_COMMANDS)[number];
export const isRunCommand = (c: string | undefined): c is RunCommand => !!c && (RUN_COMMANDS as readonly string[]).includes(c);

export const DEFAULT_MAX_TICKETS = 6;
/** Planner and director (about 12% of spend; planning needs judgment). Override with HAL_MODEL. */
export const DEFAULT_MODEL = 'opus';
/** The implementer (about 88% of spend; fix rounds and Hal's checks catch weaker builds). Override with HAL_IMPLEMENTER_MODEL. */
export const DEFAULT_IMPLEMENTER_MODEL = 'sonnet';

/** A macOS notification through osascript (no shell). Best effort: no notification is not an error. */
export function macNotify(title: string, body: string): void {
  if (process.platform !== 'darwin') return;
  const q = (s: string) => `"${s.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
  const child = spawn('/usr/bin/osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}
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
  // Every run bills the subscription first (nightly too: Brian's call, 2026-11-12); run.ts falls back to the API
  // only when the subscription hits a usage limit. --billing api forces credits.
  let billing: Billing = 'subscription';
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
    const { times, rest: args } = takeTimes(rest);
    const o = parseRunArgs(args, d.games);
    const deps = d.makeDeps ?? (() => realRunDeps(repo, d.halDir));
    return runSeries(times, (series) => runNight(series ? { ...o, series } : o, deps()), () => seriesStopReason(d.halDir, STOP_FILE), (s) => console.log(s));
  }
  if (c === 'ship' || c === 'drop') {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { 'no-push': { type: 'boolean' }, pending: { type: 'boolean' } } });
    if (c === 'ship' && values.pending) {
      if (positionals.length) throw new Error('usage: hal ship --pending [--no-push]');
      return shipPendingCommand({ push: values['no-push'] !== true }, (d.makeDeps ?? (() => realRunDeps(repo, d.halDir)))());
    }
    const pass = positionals[0];
    if (!pass || positionals.length > 1 || !/^HAL-\d+$/.test(pass)) throw new Error(`usage: hal ${c} HAL-0xx${c === 'ship' ? ' [--no-push]  (or: hal ship --pending)' : ''}`);
    return heldCommand(c, pass, { push: values['no-push'] !== true }, (d.makeDeps ?? (() => realRunDeps(repo, d.halDir)))());
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
  // Redacted everywhere: the key, the dashboard token, and any Claude credential in .hal.env or the environment.
  const secrets = [...new Set([apiKey, env.HAL_TOKEN, env.CLAUDE_CODE_OAUTH_TOKEN, env.ANTHROPIC_AUTH_TOKEN, process.env.ANTHROPIC_API_KEY, process.env.CLAUDE_CODE_OAUTH_TOKEN, process.env.ANTHROPIC_AUTH_TOKEN, process.env.HAL_TOKEN]
    .map((v) => v?.trim()).filter((v): v is string => !!v))];
  const claudeDeps: ClaudeDeps = { spawn: (cmd, args, o) => spawn(cmd, args, o), env: process.env, now: Date.now, ...(apiKey ? { apiKey } : {}) };
  return {
    repo, halDir, now: () => new Date(), model: env.HAL_MODEL?.trim() || DEFAULT_MODEL,
    implementerModel: env.HAL_IMPLEMENTER_MODEL?.trim() || DEFAULT_IMPLEMENTER_MODEL, secrets, hasApiKey: !!apiKey,
    // R24: every role, both billings, gets the repo's CLAUDE.md the same way (--bare skips auto-discovery).
    ...(existsSync(join(repo, 'CLAUDE.md')) ? { appendSystemPromptFile: join(repo, 'CLAUDE.md') } : {}),
    // One spawn per call; run.ts reserves spend first and does the subscription -> API fallback itself.
    claude: (call) => runClaude(call, claudeDeps),
    notify: macNotify,
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
  const run = <T>(argv: string[], dir: string, writable: string[] = []) => entryCheck<T>(argv, { cwd: dir, repo, secrets, writable, timeoutMs: CHECK_TIMEOUT_MS });
  return {
    score: (dir, scorer) => run<ScoreReport<unknown>>(cmds().score(dir, scorer), dir),
    async screens(dir, game, outDir) {
      // The check writes its shots straight into outDir (its only writable dir besides its private temp dir, which is
      // removed when it ends). Only regular files inside outDir are listed.
      await mkdir(outDir, { recursive: true });
      const r = await run<ScreensResult>([...cmds().screens(dir, game), outDir], dir, [outDir]);
      const inside = (s: string) => { const rel = relative(resolve(outDir), resolve(s)); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
      const shots = (r.shots ?? []).filter((s) => typeof s === 'string' && inside(s)).filter((s) => { try { return lstatSync(s).isFile(); } catch { return false; } });
      return { ...r, shots };
    },
    controls: (dir, game) => run<ControlCheck[]>(cmds().controls(dir, game), dir),
  };
}

/** Hal's ci:local: scripts/hal/ci-sandboxed.ts (npm ci unsandboxed, every other step sandboxed); writes .data/ci/<sha>.json. */
export function realCiLocal(repo: string, secrets: string[]): CiLocal {
  return async (sha) => { const r = await ciLocalSandboxed(sha, { repo, secrets }); return { ok: r.ok, detail: r.detail }; };
}
