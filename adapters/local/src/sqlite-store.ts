import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type * as Sqlite from 'node:sqlite';
import type {
  AuditEntry, Game, InboxItem, InboxStatus, LedgerEntry, MetricsSnapshot, RegistryStore, Settings,
} from '@studio/core';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games   (slug TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit   (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, game TEXT, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox   (id TEXT PRIMARY KEY, status TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger  (seq INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, at TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metrics (seq INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, channel TEXT NOT NULL, as_of TEXT NOT NULL, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, doc TEXT NOT NULL);
`;

// Loaded via require: Vite (vitest) doesn't recognise node:sqlite as a builtin yet.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof Sqlite;

type Row = { doc: string };
const parse = <T>(r: unknown): T => JSON.parse((r as Row).doc) as T;
const docs = <T>(rows: unknown[]): T[] => rows.map((r) => parse<T>(r));

export interface SqliteStore extends RegistryStore { close(): void }

/** RegistryStore on `node:sqlite` for local dev. Single-process: locks are in-memory promise chains. */
export function createSqliteStore(path: string, ids: () => string = randomUUID): SqliteStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const locks = new Map<string, Promise<unknown>>();

  return {
    async getGame(slug) {
      const r = db.prepare('SELECT doc FROM games WHERE slug = ?').get(slug);
      return r ? parse<Game>(r) : undefined;
    },
    async putGame(g) {
      db.prepare('INSERT INTO games (slug, doc) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET doc = excluded.doc')
        .run(g.slug, JSON.stringify(g));
    },
    async listGames() { return docs<Game>(db.prepare('SELECT doc FROM games ORDER BY slug').all()); },

    async appendAudit(e) {
      const entry: AuditEntry = { ...e, id: ids() };
      db.prepare('INSERT INTO audit (id, game, doc) VALUES (?, ?, ?)').run(entry.id, e.gameSlug ?? null, JSON.stringify(entry));
      return structuredClone(entry);
    },
    async listAudit(f) {
      const rows = f?.gameSlug
        ? db.prepare('SELECT doc FROM audit WHERE game = ? ORDER BY seq').all(f.gameSlug)
        : db.prepare('SELECT doc FROM audit ORDER BY seq').all();
      return docs<AuditEntry>(rows);
    },

    async putInboxItem(i) {
      db.prepare('INSERT INTO inbox (id, status, doc) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, doc = excluded.doc')
        .run(i.id, i.status, JSON.stringify(i));
    },
    async getInboxItem(id) {
      const r = db.prepare('SELECT doc FROM inbox WHERE id = ?').get(id);
      return r ? parse<InboxItem>(r) : undefined;
    },
    async listInbox(status?: InboxStatus) {
      const rows = status
        ? db.prepare('SELECT doc FROM inbox WHERE status = ? ORDER BY rowid').all(status)
        : db.prepare('SELECT doc FROM inbox ORDER BY rowid').all();
      return docs<InboxItem>(rows);
    },
    async transitionInboxItem(id, expected, patch) {
      const r = db.prepare('SELECT doc FROM inbox WHERE id = ?').get(id);
      if (!r) return false;
      const next: InboxItem = { ...parse<InboxItem>(r), ...patch, id };
      const res = db.prepare('UPDATE inbox SET status = ?, doc = ? WHERE id = ? AND status = ?')
        .run(next.status, JSON.stringify(next), id, expected);
      return Number(res.changes) === 1;
    },

    async appendLedger(e) {
      const entry: LedgerEntry = { ...e, id: ids() };
      db.prepare('INSERT INTO ledger (game, at, doc) VALUES (?, ?, ?)').run(e.gameSlug, e.at, JSON.stringify(entry));
      return structuredClone(entry);
    },
    async listLedger(f) {
      const rows = db.prepare(
        'SELECT doc FROM ledger WHERE (?1 IS NULL OR game = ?1) AND (?2 IS NULL OR at >= ?2) ORDER BY seq',
      ).all(f?.gameSlug ?? null, f?.sinceIso ?? null);
      return docs<LedgerEntry>(rows);
    },

    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prev = locks.get(key) ?? Promise.resolve();
      const run = prev.then(fn, fn);
      locks.set(key, run.catch(() => undefined));
      return run;
    },

    async putMetrics(m: MetricsSnapshot) {
      db.prepare('INSERT INTO metrics (game, channel, as_of, doc) VALUES (?, ?, ?, ?)')
        .run(m.gameSlug, m.channel, m.asOf, JSON.stringify(m));
    },
    async latestMetrics(slug) {
      const rows = db.prepare(`
        SELECT doc FROM metrics m WHERE game = ? AND seq = (
          SELECT seq FROM metrics x WHERE x.game = m.game AND x.channel = m.channel ORDER BY as_of DESC, seq DESC LIMIT 1
        ) ORDER BY channel`).all(slug);
      return docs<MetricsSnapshot>(rows);
    },

    async getSettings() {
      const r = db.prepare("SELECT doc FROM settings WHERE k = 'settings'").get();
      return r ? parse<Settings>(r) : { killSwitch: { engaged: false } };
    },
    async putSettings(s) {
      db.prepare("INSERT INTO settings (k, doc) VALUES ('settings', ?) ON CONFLICT(k) DO UPDATE SET doc = excluded.doc")
        .run(JSON.stringify(s));
    },

    close() { db.close(); },
  };
}
