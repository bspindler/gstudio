import { randomUUID } from 'node:crypto';
import type {
  AuditEntry, Game, InboxItem, InboxStatus, LedgerEntry, MetricsSnapshot, Settings,
} from '../domain/types.js';
import type { RegistryStore } from './store.js';

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory RegistryStore for tests and demos. Clones on every read and write. */
export class MemoryStore implements RegistryStore {
  readonly #games = new Map<string, Game>();
  readonly #audit: AuditEntry[] = [];
  readonly #inbox = new Map<string, InboxItem>();
  readonly #ledger: LedgerEntry[] = [];
  readonly #metrics: MetricsSnapshot[] = [];
  readonly #locks = new Map<string, Promise<unknown>>();
  #settings: Settings = { killSwitch: { engaged: false } };

  constructor(private readonly ids: () => string = randomUUID) {}

  async getGame(slug: string) { const g = this.#games.get(slug); return g && clone(g); }
  async putGame(g: Game) { this.#games.set(g.slug, clone(g)); }
  async listGames() { return [...this.#games.values()].map(clone); }

  async appendAudit(e: Omit<AuditEntry, 'id'>) {
    const entry = { ...clone(e), id: this.ids() };
    this.#audit.push(entry);
    return clone(entry);
  }
  async listAudit(f?: { gameSlug?: string }) {
    return this.#audit.filter((e) => !f?.gameSlug || e.gameSlug === f.gameSlug).map(clone);
  }

  async putInboxItem(i: InboxItem) { this.#inbox.set(i.id, clone(i)); }
  async getInboxItem(id: string) { const i = this.#inbox.get(id); return i && clone(i); }
  async listInbox(status?: InboxStatus) {
    return [...this.#inbox.values()].filter((i) => !status || i.status === status).map(clone);
  }
  async transitionInboxItem(id: string, expected: InboxStatus, patch: Partial<InboxItem>) {
    const cur = this.#inbox.get(id);
    if (!cur || cur.status !== expected) return false;
    this.#inbox.set(id, { ...cur, ...clone(patch), id });
    return true;
  }

  async appendLedger(e: Omit<LedgerEntry, 'id'>) {
    const entry = { ...clone(e), id: this.ids() };
    this.#ledger.push(entry);
    return clone(entry);
  }
  async listLedger(f?: { gameSlug?: string; sinceIso?: string }) {
    return this.#ledger
      .filter((e) => (!f?.gameSlug || e.gameSlug === f.gameSlug) && (!f?.sinceIso || e.at >= f.sinceIso))
      .map(clone);
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.#locks.set(key, run.catch(() => undefined));
    return run;
  }

  async putMetrics(m: MetricsSnapshot) { this.#metrics.push(clone(m)); }
  async latestMetrics(slug: string) {
    const latest = new Map<string, MetricsSnapshot>();
    for (const m of this.#metrics) {
      if (m.gameSlug !== slug) continue;
      const cur = latest.get(m.channel);
      if (!cur || m.asOf > cur.asOf) latest.set(m.channel, m);
    }
    return [...latest.values()].map(clone);
  }

  async getSettings() { return clone(this.#settings); }
  async putSettings(s: Settings) { this.#settings = clone(s); }
}
