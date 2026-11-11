// Hal's local state under .data/hal/: notes, feedback, approvals, spend, runs/<runId>/. Every write is atomic
// (temp file in the same directory, then rename). The clock is injected so tests and ids are deterministic.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayFor, type Approval, type SpendDay } from '@studio/core/hal';

export type NoteStatus = 'open' | 'acted' | 'queued' | 'asked';
export type Note = { id: string; at: string; game: string | null; text: string; status: NoteStatus; reply?: string };
export type Vote = { run: string; item: string; game?: string; vote: 'up' | 'down'; at: string };
export type Undo = { run: string; reason: string; at: string };
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

    async addVote(v: Omit<Vote, 'at'>): Promise<void> {
      const f = await readFeedback();
      await writeJsonAtomic(p('feedback.json'), { ...f, votes: [...f.votes, { ...v, at: now().toISOString() }] });
    },
    async addUndo(u: Omit<Undo, 'at'>): Promise<void> {
      const f = await readFeedback();
      await writeJsonAtomic(p('feedback.json'), { ...f, undos: [...f.undos, { ...u, at: now().toISOString() }] });
    },

    /** Today's ledger (local day of the injected clock), empty if none yet. Task 7 calls this under the run lock. */
    async loadSpendToday(): Promise<SpendDay> {
      const days = await readSpend();
      return dayFor(days.find((d) => d.day === dayFor(undefined, now()).day), now());
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
