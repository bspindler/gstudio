// Hal's local state under .data/hal/: notes, feedback, approvals, spend, runs/<runId>/. Every write is atomic
// (temp file in the same directory, then rename). The clock is injected so tests and ids are deterministic.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayFor, type Approval, type SpendDay } from '@studio/core/hal';

export type NoteStatus = 'open' | 'acted' | 'queued' | 'asked';
export type Note = { id: string; at: string; game: string | null; text: string; status: NoteStatus; reply?: string };
export type Vote = { run: string; item: string; game?: string; vote: 'up' | 'down'; at: string; /** Brian's words, capped at 500 characters by the caller. */ comment?: string };
export type UndoStatus = 'pending' | 'done' | 'failed' | 'rejected';
/**
 * An undo request or its outcome. `pass` (HAL-0xx) and `status` are set by `hal undo` and by the run's preflight:
 * `pending` (asked, e.g. from the report page) and `failed` (conflict, tests) are retried by the next run's preflight;
 * `rejected` (no such merged pass) and `done` are not.
 */
export type Undo = { run: string; reason: string; at: string; pass?: string; status?: UndoStatus; commit?: string; error?: string };
export type Feedback = { votes: Vote[]; undos: Undo[] };
export type Store = ReturnType<typeof createStore>;

export const KEEP_SPEND_DAYS = 60;

/** `<repo>/.data/hal` */
export const defaultHalDir = () => fileURLToPath(new URL('../../.data/hal', import.meta.url));

let seq = 0;
/** Writes JSON by temp-file-then-rename in the same directory; a failure leaves any existing file untouched. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2) + '\n'; // serialize first: a throw here touches nothing
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${seq++}.tmp`;
  try {
    await writeFile(tmp, text);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** writeJsonAtomic, synchronously: for the spend ledger, which is saved after every Claude call under the run lock. */
export function writeJsonAtomicSync(path: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2) + '\n';
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${seq++}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function readJsonSync<T>(path: string, fallback: T, valid: (v: unknown) => boolean): T {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON: ${(e as Error).message}`); }
  if (!valid(v)) throw new Error(`${path} has an unexpected shape`);
  return v as T;
}

async function readJson<T>(path: string, fallback: T, valid: (v: unknown) => boolean): Promise<T> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON: ${(e as Error).message}`); }
  if (!valid(v)) throw new Error(`${path} has an unexpected shape`);
  return v as T;
}

const isArr = (v: unknown) => Array.isArray(v);
const isFeedback = (v: unknown) => !!v && isArr((v as Feedback).votes) && isArr((v as Feedback).undos);
const normItem = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function createStore({ halDir = defaultHalDir(), now = () => new Date() }: { halDir?: string; now?: () => Date } = {}) {
  const p = (f: string) => join(halDir, f);
  const readNotes = () => readJson<Note[]>(p('notes.json'), [], isArr);
  const readApprovals = () => readJson<Approval[]>(p('approvals.json'), [], isArr);
  const readFeedback = () => readJson<Feedback>(p('feedback.json'), { votes: [], undos: [] }, isFeedback);
  const readSpend = () => readJson<SpendDay[]>(p('spend.json'), [], isArr);

  return {
    halDir, readNotes, readApprovals, readFeedback, readSpend,

    async addNote({ text, game }: { text: string; game: string | null }): Promise<Note> {
      const notes = await readNotes();
      const max = notes.reduce((m, n) => Math.max(m, Number(/^N-(\d+)$/.exec(n.id)?.[1] ?? 0)), 0);
      const note: Note = { id: `N-${String(max + 1).padStart(3, '0')}`, at: now().toISOString(), game, text, status: 'open' };
      await writeJsonAtomic(p('notes.json'), [...notes, note]);
      return note;
    },
    /** Removes the note. False if there is no such id. */
    async clearNote(id: string): Promise<boolean> {
      const notes = await readNotes();
      if (!notes.some((n) => n.id === id)) return false;
      await writeJsonAtomic(p('notes.json'), notes.filter((n) => n.id !== id));
      return true;
    },
    async setNote(id: string, patch: { status: NoteStatus; reply?: string }): Promise<boolean> {
      const notes = await readNotes();
      if (!notes.some((n) => n.id === id)) return false;
      await writeJsonAtomic(p('notes.json'), notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
      return true;
    },

    /** Idempotent per item (case and spacing ignored). */
    async addApproval(item: string): Promise<Approval> {
      const list = await readApprovals();
      const have = list.find((a) => normItem(a.item) === normItem(item));
      if (have) return have;
      const a: Approval = { item: item.trim(), at: now().toISOString(), by: 'brian' };
      await writeJsonAtomic(p('approvals.json'), [...list, a]);
      return a;
    },

    /** Votes and undo reasons for one run, newest last. */
    async feedbackFor(run: string): Promise<Feedback> {
      const f = await readFeedback();
      return { votes: f.votes.filter((v) => v.run === run), undos: f.undos.filter((u) => u.run === run) };
    },
    async addVote(v: Omit<Vote, 'at'>): Promise<void> {
      const f = await readFeedback();
      await writeJsonAtomic(p('feedback.json'), { ...f, votes: [...f.votes, { ...v, at: now().toISOString() }] });
    },
    async addUndo(u: Omit<Undo, 'at'>): Promise<void> {
      const f = await readFeedback();
      await writeJsonAtomic(p('feedback.json'), { ...f, undos: [...f.undos, { ...u, at: now().toISOString() }] });
    },
    /** Re-reads feedback.json and updates the newest unfinished entry for `u.pass` (pending/failed), or appends one. */
    async recordUndo(u: Omit<Undo, 'at'> & { pass: string; status: UndoStatus }): Promise<void> {
      const f = await readFeedback();
      const undos = [...f.undos];
      let i = -1;
      for (let j = undos.length - 1; j >= 0; j--) if (undos[j]!.pass === u.pass && (undos[j]!.status === 'pending' || undos[j]!.status === 'failed')) { i = j; break; }
      const merged: Undo = { ...(i >= 0 ? undos[i]! : {}), ...u, at: now().toISOString() };
      if (u.status === 'done') delete merged.error;
      if (i >= 0) undos[i] = merged; else undos.push(merged);
      await writeJsonAtomic(p('feedback.json'), { ...f, undos });
    },
    /** Undos still to do (pending, or failed last time), newest request per pass. */
    async pendingUndos(): Promise<Array<Undo & { pass: string }>> {
      const by = new Map<string, Undo & { pass: string }>();
      for (const u of (await readFeedback()).undos) {
        if (typeof u.pass !== 'string' || !/^HAL-\d+$/.test(u.pass)) continue;
        if (u.status === 'pending' || u.status === 'failed') by.set(u.pass, u as Undo & { pass: string });
        else by.delete(u.pass);
      }
      return [...by.values()];
    },

    /** Today's ledger (local day of the injected clock), empty if none yet. Task 7 calls this under the run lock. */
    async loadSpendToday(): Promise<SpendDay> {
      const days = await readSpend();
      return dayFor(days.find((d) => d.day === dayFor(undefined, now()).day), now());
    },
    /** loadSpendToday, synchronously (the CandidateBudget port is synchronous). Call only under the run lock. */
    loadSpendTodaySync(): SpendDay {
      const days = readJsonSync<SpendDay[]>(p('spend.json'), [], isArr);
      return dayFor(days.find((d) => d.day === dayFor(undefined, now()).day), now());
    },
    /** A given day's ledger (YYYY-MM-DD), synchronously: a reservation is settled in the day it was made. */
    loadSpendDaySync(day: string): SpendDay {
      return readJsonSync<SpendDay[]>(p('spend.json'), [], isArr).find((d) => d.day === day) ?? { day, calls: [] };
    },
    /** saveSpendDay, synchronously: the record is on disk before the next Claude call can start. */
    saveSpendDaySync(day: SpendDay): void {
      const days = [...readJsonSync<SpendDay[]>(p('spend.json'), [], isArr).filter((d) => d.day !== day.day), day].sort((a, b) => a.day.localeCompare(b.day));
      writeJsonAtomicSync(p('spend.json'), days.slice(-KEEP_SPEND_DAYS));
    },
    /** Replaces that day's entry, keeps the newest 60 days, sorted by day. */
    async saveSpendDay(day: SpendDay): Promise<void> {
      const days = [...(await readSpend()).filter((d) => d.day !== day.day), day].sort((a, b) => a.day.localeCompare(b.day));
      await writeJsonAtomic(p('spend.json'), days.slice(-KEEP_SPEND_DAYS));
    },

    /** `runs/<runId>`; the id must be a plain name. */
    runDir(runId: string): string {
      if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === '.' || runId === '..') throw new Error(`bad run id: ${runId}`);
      return p(join('runs', runId));
    },
  };
}
