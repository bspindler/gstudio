// Hal's local state under .data/hal/: notes, feedback, approvals, spend, runs/<runId>/. Every write is atomic
// (temp file in the same directory, then rename), and every read-modify-write of notes, feedback and approvals holds
// that file's lock (withFileLock): the report server and a running Hal are separate processes that both write them.
// The clock is injected so tests and ids are deterministic.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayFor, type Approval, type SpendDay } from '@studio/core/hal';

export type NoteStatus = 'open' | 'acted' | 'queued' | 'asked';
/** One message in a note's thread. `run`: the run whose director wrote it (Hal's messages). */
export type NoteMessage = { from: 'brian' | 'hal'; text: string; at: string; run?: string };
/**
 * A Tell Hal thread. `text` is Brian's first message and `reply` Hal's latest (kept for older readers); `thread` is the
 * whole conversation. Notes written before threads have no `thread`: threadOf builds it from text and reply.
 * `ref`: the report this thread replies to (Brian answered that night's Director's note).
 */
export type Note = { id: string; at: string; game: string | null; text: string; status: NoteStatus; reply?: string; thread?: NoteMessage[]; ref?: { run: string; night?: string } };

/** The note's messages, oldest first (from text and reply for a note written before threads). */
export function threadOf(n: Note): NoteMessage[] {
  if (Array.isArray(n.thread) && n.thread.length) return n.thread;
  return [{ from: 'brian', text: n.text, at: n.at }, ...(n.reply ? [{ from: 'hal' as const, text: n.reply, at: n.at }] : [])];
}
/**
 * Something Hal has learned, kept across nights (lessons.json): short, specific, about one game or the whole studio.
 * The director adds and retires them; the planner and director read every active one.
 */
export type Lesson = { id: string; game: string | null; text: string; at: string; run: string };
/** Lessons kept at most; past this the oldest are dropped (the director is asked to retire stale ones first). */
export const MAX_LESSONS = 40;

/** When the thread last moved: its newest message. */
export const lastAt = (n: Note): string => threadOf(n).at(-1)?.at ?? n.at;
export type Vote = { run: string; item: string; game?: string; vote: 'up' | 'down'; at: string; /** Brian's words, capped at 500 characters by the caller. */ comment?: string };
export type UndoStatus = 'pending' | 'done' | 'failed' | 'rejected';
/**
 * An undo request or its outcome. `pass` (HAL-0xx) and `status` are set by `hal undo` and by the run's preflight:
 * `pending` (asked, e.g. from the report page) and `failed` (conflict, tests) are retried by the next run's preflight;
 * `rejected` (no such merged pass) and `done` are not.
 * `run` is the run whose report asked for it (feedbackFor filters on it); `undoRun` is the run or `hal undo` that applied
 * or tried it, when that differs. `version` is the game version the undo commit released (set when done).
 */
export type Undo = { run: string; reason: string; at: string; pass?: string; status?: UndoStatus; commit?: string; error?: string; undoRun?: string; version?: string };
/** Brian's decision on a held feature: ship it onto main, or drop it. Applied at once, or by the next run if Hal is busy. */
export type HeldDecision = { pass: string; run: string; decision: 'ship' | 'drop'; status: 'pending' | 'done' | 'failed'; at: string; commit?: string; error?: string; version?: string };
export type Feedback = { votes: Vote[]; undos: Undo[]; held?: HeldDecision[] };
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

/** Whether a pid is alive (EPERM: alive, someone else's). */
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/**
 * Runs `fn` holding `lockPath`, a lock file made with O_EXCL (only one process can create it). A lock left by a dead
 * process, or older than `staleMs`, is taken over. Waits up to `timeoutMs` for a live holder, then throws, so a
 * write is never made unlocked.
 */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, o: { timeoutMs?: number; staleMs?: number } = {}): Promise<T> {
  const timeoutMs = o.timeoutMs ?? 10_000, staleMs = o.staleMs ?? 30_000, start = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      const fh = await open(lockPath, 'wx');
      try { await fh.writeFile(`${process.pid} ${new Date().toISOString()}\n`); } finally { await fh.close(); }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    try {
      const [st, text] = await Promise.all([stat(lockPath), readFile(lockPath, 'utf8')]);
      const pid = Number(text.split(' ')[0]);
      const dead = Number.isInteger(pid) && pid > 0 && pid !== process.pid && !pidAlive(pid);
      if (dead || Date.now() - st.mtimeMs > staleMs) { await rm(lockPath, { force: true }); continue; }
    } catch { continue; } // it went away between the two calls: try again
    if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${lockPath}`);
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 35));
  }
  try { return await fn(); } finally { await rm(lockPath, { force: true }).catch(() => {}); }
}

const isArr = (v: unknown) => Array.isArray(v);
const isFeedback = (v: unknown) => !!v && isArr((v as Feedback).votes) && isArr((v as Feedback).undos);
const normItem = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function createStore({ halDir = defaultHalDir(), now = () => new Date() }: { halDir?: string; now?: () => Date } = {}) {
  const p = (f: string) => join(halDir, f);
  /** Holds `<file>.lock` around a read-modify-write of `file`. */
  const locked = <T>(file: string, fn: () => Promise<T>) => withFileLock(p(`${file}.lock`), fn);
  const readNotes = () => readJson<Note[]>(p('notes.json'), [], isArr);
  const readApprovals = () => readJson<Approval[]>(p('approvals.json'), [], isArr);
  const readFeedback = () => readJson<Feedback>(p('feedback.json'), { votes: [], undos: [] }, isFeedback);
  const readSpend = () => readJson<SpendDay[]>(p('spend.json'), [], isArr);
  const readLessons = () => readJson<Lesson[]>(p('lessons.json'), [], isArr);

  return {
    halDir, readNotes, readApprovals, readFeedback, readSpend, readLessons,
    /** The director's changes to the lessons: retire by id, then add (new ids), keeping the newest MAX_LESSONS. */
    async applyLessons(change: { add: Array<{ game: string | null; text: string }>; retire: string[] }, run: string): Promise<{ added: Lesson[]; retired: string[] }> {
      return locked('lessons.json', async () => {
        const list = await readLessons();
        const retired = change.retire.filter((id) => list.some((l) => l.id === id));
        let max = list.reduce((m, l) => Math.max(m, Number(/^L-(\d+)$/.exec(l.id)?.[1] ?? 0)), 0);
        const have = new Set(list.map((l) => l.text.toLowerCase()));
        const at = now().toISOString();
        const added = change.add.filter((a) => !have.has(a.text.toLowerCase())).map((a) => ({ id: `L-${String(++max).padStart(3, '0')}`, game: a.game, text: a.text, at, run }));
        const next = [...list.filter((l) => !retired.includes(l.id)), ...added].slice(-MAX_LESSONS);
        if (added.length || retired.length) await writeJsonAtomic(p('lessons.json'), next);
        return { added, retired };
      });
    },

    async addNote({ text, game, ref }: { text: string; game: string | null; ref?: Note['ref'] }): Promise<Note> {
      return locked('notes.json', async () => {
        const notes = await readNotes();
        const max = notes.reduce((m, n) => Math.max(m, Number(/^N-(\d+)$/.exec(n.id)?.[1] ?? 0)), 0);
        const at = now().toISOString();
        const note: Note = { id: `N-${String(max + 1).padStart(3, '0')}`, at, game, text, status: 'open', thread: [{ from: 'brian', text, at }], ...(ref ? { ref } : {}) };
        await writeJsonAtomic(p('notes.json'), [...notes, note]);
        return note;
      });
    },
    /** Removes the note. False if there is no such id. */
    async clearNote(id: string): Promise<boolean> {
      return locked('notes.json', async () => {
        const notes = await readNotes();
        if (!notes.some((n) => n.id === id)) return false;
        await writeJsonAtomic(p('notes.json'), notes.filter((n) => n.id !== id));
        return true;
      });
    },
    /** Brian replies in a thread: the message is added and the note is open again (Hal answers it next run). */
    async addReply(id: string, text: string): Promise<boolean> {
      return locked('notes.json', async () => {
        const notes = await readNotes();
        if (!notes.some((n) => n.id === id)) return false;
        const at = now().toISOString();
        await writeJsonAtomic(p('notes.json'), notes.map((n) => (n.id === id ? { ...n, status: 'open' as const, thread: [...threadOf(n), { from: 'brian' as const, text, at }] } : n)));
        return true;
      });
    },
    /**
     * Hal's answer (the director, once per run): sets the status and adds `reply` to the thread, unless it repeats Hal's
     * last message word for word with nothing from Brian since (a director restating itself is not a new message).
     */
    async setNote(id: string, patch: { status: NoteStatus; reply?: string; run?: string }): Promise<boolean> {
      return locked('notes.json', async () => {
        const notes = await readNotes();
        if (!notes.some((n) => n.id === id)) return false;
        await writeJsonAtomic(p('notes.json'), notes.map((n) => {
          if (n.id !== id) return n;
          const thread = threadOf(n);
          const last = thread.at(-1);
          const repeat = last?.from === 'hal' && last.text === patch.reply;
          const msg: NoteMessage | null = patch.reply && !repeat ? { from: 'hal', text: patch.reply, at: now().toISOString(), ...(patch.run ? { run: patch.run } : {}) } : null;
          return { ...n, status: patch.status, ...(patch.reply ? { reply: patch.reply } : {}), thread: msg ? [...thread, msg] : thread };
        }));
        return true;
      });
    },

    /** Idempotent per item (case and spacing ignored). */
    async addApproval(item: string): Promise<Approval> {
      return locked('approvals.json', async () => {
        const list = await readApprovals();
        const have = list.find((a) => normItem(a.item) === normItem(item));
        if (have) return have;
        const a: Approval = { item: item.trim(), at: now().toISOString(), by: 'brian' };
        await writeJsonAtomic(p('approvals.json'), [...list, a]);
        return a;
      });
    },

    /** Votes and undo reasons for one run, newest last. */
    async feedbackFor(run: string): Promise<Feedback> {
      const f = await readFeedback();
      return { votes: f.votes.filter((v) => v.run === run), undos: f.undos.filter((u) => u.run === run) };
    },
    async addVote(v: Omit<Vote, 'at'>): Promise<void> {
      return locked('feedback.json', async () => {
        const f = await readFeedback();
        await writeJsonAtomic(p('feedback.json'), { ...f, votes: [...f.votes, { ...v, at: now().toISOString() }] });
      });
    },
    async addUndo(u: Omit<Undo, 'at'>): Promise<void> {
      return locked('feedback.json', async () => {
        const f = await readFeedback();
        await writeJsonAtomic(p('feedback.json'), { ...f, undos: [...f.undos, { ...u, at: now().toISOString() }] });
      });
    },
    /**
     * Re-reads feedback.json and updates the newest unfinished entry for `u.pass` (pending/failed), or appends one.
     * `u.run` is the applying run's id: an existing entry keeps its own `run` (the report that asked) and gets `undoRun`.
     */
    async recordUndo(u: Omit<Undo, 'at' | 'undoRun'> & { pass: string; status: UndoStatus }): Promise<void> {
      return locked('feedback.json', async () => {
        const f = await readFeedback();
        const undos = [...f.undos];
        let i = -1;
        for (let j = undos.length - 1; j >= 0; j--) if (undos[j]!.pass === u.pass && (undos[j]!.status === 'pending' || undos[j]!.status === 'failed')) { i = j; break; }
        const prev = i >= 0 ? undos[i]! : undefined;
        const merged: Undo = { ...(prev ?? {}), ...u, at: now().toISOString() };
        if (prev && typeof prev.run === 'string' && prev.run !== u.run) { merged.run = prev.run; merged.undoRun = u.run; }
        if (u.status === 'done') delete merged.error;
        if (i >= 0) undos[i] = merged; else undos.push(merged);
        await writeJsonAtomic(p('feedback.json'), { ...f, undos });
      });
    },
    /** Records a decision on a held feature, or updates the newest one for that pass (status, commit, error). */
    async recordHeld(h: Omit<HeldDecision, 'at'>): Promise<void> {
      return locked('feedback.json', async () => {
        const f = await readFeedback();
        const list = [...(f.held ?? [])];
        let i = -1;
        for (let j = list.length - 1; j >= 0; j--) if (list[j]!.pass === h.pass && list[j]!.status !== 'done') { i = j; break; }
        const next: HeldDecision = { ...(i >= 0 ? list[i]! : {}), ...h, at: now().toISOString() };
        if (h.status === 'done') delete next.error;
        if (i >= 0) list[i] = next; else list.push(next);
        await writeJsonAtomic(p('feedback.json'), { ...f, held: list });
      });
    },
    /** Decisions on held features still to apply (pending, or failed last time), newest per pass. */
    async pendingHeld(): Promise<HeldDecision[]> {
      const by = new Map<string, HeldDecision>();
      for (const h of (await readFeedback()).held ?? []) {
        if (!/^HAL-\d+$/.test(h.pass)) continue;
        if (h.status === 'done') by.delete(h.pass); else by.set(h.pass, h);
      }
      return [...by.values()];
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
