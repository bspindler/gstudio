// Per-game history from git: commit records in, nights of entries out. Pure; the caller runs git.
import { nightOf, parseTrailers, type ChangeKind } from './release.js';

export type CommitRecord = { sha: string; author: string; date: string /* ISO */; message: string };
export type ChangeStatus =
  | { kind: 'kept' }
  | { kind: 'undone'; by: 'hal'; reason: string; commit: string; version: string }
  | { kind: 'reverted'; commit: string; date: string };
export type HistoryEntry =
  | {
      type: 'hal'; sha: string; pass: string; game: string; kind: ChangeKind; title: string; why: string;
      version: string; run: string; night: string; scoreBefore: number; scoreAfter: number; status: ChangeStatus;
      shots: { before?: string; after?: string };
    }
  | { type: 'brian'; sha: string; night: string; title: string; author: string; date: string };
export type HistoryNight = { night: string; entries: HistoryEntry[] };

const subjectOf = (message: string) => message.split(/\r?\n/, 1)[0]!.trim();
const time = (c: CommitRecord) => new Date(c.date).getTime();

/** A director's note carries Hal-Run but no Hal-Pass: Hal's own bookkeeping, never a history entry. */
function isDirectorsNote(message: string): boolean {
  return /^docs\(hal\): director's note\b/.test(subjectOf(message));
}

/**
 * `commits` for one game's history (any order); `files` are repo paths under docs/hal/history/<game>/.
 * Nights come out newest first, entries newest first within a night.
 */
export function buildHistory(game: string, commits: CommitRecord[], files: string[], tzOffsetMinutes: number): HistoryNight[] {
  const sorted = [...commits].sort((a, b) => time(b) - time(a));
  // Shots by pass id, whatever night folder they sit in: the pipeline names the folder from its own clock at build time,
  // which can differ from nightOf(commit date) near the cutoff. Pass ids are unique.
  const shotFiles = new Map<string, string>();
  const shotRe = /^([^/]+)\/\d{4}-\d{2}-\d{2}\/([^/]+)-(before|after)\.jpg$/;
  const root = `docs/hal/history/${game}/`;
  for (const f of files) {
    if (!f.startsWith(root)) continue;
    const m = shotRe.exec(`${game}/${f.slice(root.length)}`);
    if (m) shotFiles.set(`${m[2]}-${m[3]}`, f);
  }

  // Pass 1: undos by target pass, and git reverts (full or 7+ char sha prefix) by the commit they revert.
  const undone = new Map<string, Extract<ChangeStatus, { kind: 'undone' }>>();
  const reverts: Array<{ target: string; commit: string; date: string }> = [];
  for (const c of sorted) {
    const t = parseTrailers(c.message);
    if (t?.undo !== undefined) {
      if (t.game === game && !undone.has(t.undo)) undone.set(t.undo, { kind: 'undone', by: 'hal', reason: t.reason ?? '', commit: c.sha, version: t.version });
      continue;
    }
    for (const m of c.message.matchAll(/This reverts commit ([0-9a-f]{7,40})\b/gi)) reverts.push({ target: m[1]!.toLowerCase(), commit: c.sha, date: c.date });
  }
  // Undo: newest wins (first seen in a newest-first walk); revert: oldest wins (pop of the same list). Either way the change is out.
  const revertOf = (sha: string) => reverts.filter((r) => sha.toLowerCase().startsWith(r.target)).pop(); // oldest revert (list is newest first)

  // Pass 2: entries.
  const byNight = new Map<string, HistoryEntry[]>();
  const push = (e: HistoryEntry) => {
    const list = byNight.get(e.night);
    if (list) list.push(e);
    else byNight.set(e.night, [e]);
  };
  for (const c of sorted) {
    const t = parseTrailers(c.message);
    const night = nightOf(new Date(c.date), tzOffsetMinutes);
    if (t) {
      if (t.undo !== undefined || t.game !== game) continue;
      const subject = subjectOf(c.message);
      const prefix = `${t.kind}(${t.game}): `;
      const title = subject.startsWith(prefix) ? subject.slice(prefix.length) : subject;
      const rv = revertOf(c.sha);
      const status: ChangeStatus = undone.get(t.pass) ?? (rv ? { kind: 'reverted', commit: rv.commit, date: rv.date } : { kind: 'kept' });
      const shots: { before?: string; after?: string } = {};
      const before = shotFiles.get(`${t.pass}-before`);
      const after = shotFiles.get(`${t.pass}-after`);
      if (before) shots.before = before;
      if (after) shots.after = after;
      push({ type: 'hal', sha: c.sha, pass: t.pass, game: t.game, kind: t.kind, title, why: t.why, version: t.version, run: t.run, night, scoreBefore: t.scoreBefore, scoreAfter: t.scoreAfter, status, shots });
    } else {
      if (isDirectorsNote(c.message)) continue;
      push({ type: 'brian', sha: c.sha, night, title: subjectOf(c.message), author: c.author, date: c.date });
    }
  }
  return [...byNight.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)).map(([night, entries]) => ({ night, entries }));
}

export type HistoryFilter = { q?: string; kind?: ChangeKind | 'brian'; status?: 'kept' | 'undone' };

/** `q` matches title, why and pass case-insensitively; status 'undone' includes reverted. Nights left empty are dropped. */
export function filterHistory(nights: HistoryNight[], f: HistoryFilter): HistoryNight[] {
  const q = f.q?.trim().toLowerCase();
  const keep = (e: HistoryEntry): boolean => {
    if (f.kind !== undefined && (e.type === 'brian' ? 'brian' : e.kind) !== f.kind) return false;
    if (f.status !== undefined && (e.type !== 'hal' || (f.status === 'kept') !== (e.status.kind === 'kept'))) return false;
    if (q) {
      const hay = e.type === 'hal' ? [e.title, e.why, e.pass] : [e.title];
      if (!hay.some((s) => s.toLowerCase().includes(q))) return false;
    }
    return true;
  };
  return nights.map((n) => ({ night: n.night, entries: n.entries.filter(keep) })).filter((n) => n.entries.length > 0);
}
