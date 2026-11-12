// Reads one game's history out of git for the shelf's History page. execFile only (no shell); `game` always comes
// from the shelf's slug list. Everything is read from commits (the tip), never from the working tree.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildHistory, type CommitRecord, type HistoryNight } from '@studio/core/hal';
import { GIT_TIMEOUT_MS, gitEnv } from './git.js';

const exec = promisify(execFile);
const MAX = 64 * 1024 * 1024;
const HAL_MAIN = 'refs/hal/main';

export type ScoreRun = { night: string; run: string; scorers: Record<string, { fitness: number; measures: Record<string, number> }> };
/** `me`: the repo's `git config user.name` (whose commits are "Yours"), or null when it is not set. */
export type GameHistory = { nights: HistoryNight[]; notes: Record<string, string>; scores: ScoreRun[]; me: string | null };

const git = async (repo: string, args: string[]): Promise<Buffer> =>
  (await exec('git', args, { cwd: repo, env: gitEnv(), encoding: 'buffer', maxBuffer: MAX, timeout: GIT_TIMEOUT_MS })).stdout;
const ok = (repo: string, args: string[]) => git(repo, args).then(() => true, () => false);

const userNames = new Map<string, Promise<string | null>>();
/** The repo's configured `user.name`, read once per repo for the life of the process; null when unset or on a failure. */
export function repoUserName(repo: string): Promise<string | null> {
  let p = userNames.get(repo);
  if (!p) {
    p = git(repo, ['config', '--get', 'user.name']).then((b) => b.toString('utf8').trim() || null, () => null);
    userNames.set(repo, p);
  }
  return p;
}

/** Whether refs/hal/main exists, and the tip to read: it if it contains HEAD, else HEAD. Probed once per call. */
export async function refState(repo: string): Promise<{ hasHalMain: boolean; tip: string }> {
  if (!(await ok(repo, ['rev-parse', '--verify', '-q', HAL_MAIN]))) return { hasHalMain: false, tip: 'HEAD' };
  return { hasHalMain: true, tip: (await ok(repo, ['merge-base', '--is-ancestor', 'HEAD', HAL_MAIN])) ? HAL_MAIN : 'HEAD' };
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function parseScores(night: string, text: string): ScoreRun[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return []; }
  const runs = (j as { runs?: unknown })?.runs;
  if (!Array.isArray(runs)) return [];
  const out: ScoreRun[] = [];
  for (const r of runs) {
    if (!r || typeof r !== 'object' || typeof (r as { run?: unknown }).run !== 'string') continue;
    const scorers: ScoreRun['scorers'] = {};
    const raw = (r as { scorers?: unknown }).scorers;
    for (const [name, s] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      const fitness = (s as { fitness?: unknown })?.fitness;
      if (!num(fitness)) continue;
      const measures: Record<string, number> = {};
      const m = (s as { measures?: unknown }).measures;
      for (const [k, v] of Object.entries(m && typeof m === 'object' ? m : {})) if (num(v)) measures[k] = v;
      scorers[name] = { fitness, measures };
    }
    if (Object.keys(scorers).length) out.push({ night, run: (r as { run: string }).run, scorers }); // scorers {} are skipped
  }
  return out;
}

export async function readGameHistory(repo: string, game: string, tzOffsetMinutes = -new Date().getTimezoneOffset()): Promise<GameHistory> {
  const { hasHalMain, tip } = await refState(repo);
  const revs = hasHalMain ? ['HEAD', HAL_MAIN] : ['HEAD'];
  const log = (await git(repo, ['log', '--format=%H%x00%an%x00%aI%x00%B%x1e', ...revs, '--', `games/${game}`, `docs/hal/history/${game}`])).toString('utf8');
  const commits: CommitRecord[] = [];
  for (const rec of log.split('\x1e')) {
    const [sha, author, date, ...rest] = rec.replace(/^\s+/, '').split('\0');
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
    commits.push({ sha, author: author ?? '', date: date ?? '', message: rest.join('\0').trim() });
  }
  const dir = `docs/hal/history/${game}`;
  const files = (await git(repo, ['ls-tree', '-r', '--name-only', tip, '--', dir])).toString('utf8').split('\n').filter(Boolean);
  const nights = buildHistory(game, commits, files, tzOffsetMinutes);

  const notes: Record<string, string> = {};
  const scores: ScoreRun[] = [];
  const nightDirs = new Set<string>();
  for (const f of files) {
    const m = /^docs\/hal\/history\/[^/]+\/(\d{4}-\d{2}-\d{2})\/(note\.md|scores\.json)$/.exec(f);
    if (m) nightDirs.add(`${m[1]}/${m[2]}`);
  }
  for (const key of [...nightDirs].sort()) {
    const [night, file] = key.split('/') as [string, string];
    const text = await git(repo, ['show', `${tip}:${dir}/${night}/${file}`]).then((b) => b.toString('utf8'), () => null);
    if (text === null) continue;
    if (file === 'note.md') notes[night] = text;
    else scores.push(...parseScores(night, text));
  }
  return { nights, notes, scores, me: await repoUserName(repo) };
}

/** The committed bytes of one history image at the tip, or null (missing, a symlink, or not a regular file). */
export async function readHistoryImage(repo: string, game: string, night: string, file: string): Promise<Buffer | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night) || !/^HAL-\d+-(before|after)\.jpg$/.test(file)) return null;
  const { tip } = await refState(repo);
  const path = `docs/hal/history/${game}/${night}/${file}`;
  const entry = (await git(repo, ['ls-tree', tip, '--', path])).toString('utf8'); // a git failure throws (the route answers 500)
  if (!entry.startsWith('100644 blob ') && !entry.startsWith('100755 blob ')) return null; // missing, or a symlink (mode 120000)
  return await git(repo, ['show', `${tip}:${path}`]);
}
