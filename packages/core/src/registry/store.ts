import type {
  AuditEntry, Game, InboxItem, InboxStatus, LedgerEntry, MetricsSnapshot, Settings,
} from '../domain/types.js';

export interface RegistryStore {
  getGame(slug: string): Promise<Game | undefined>;
  putGame(g: Game): Promise<void>;
  listGames(): Promise<Game[]>;
  appendAudit(e: Omit<AuditEntry, 'id'>): Promise<AuditEntry>;
  /** Oldest first. */
  listAudit(f?: { gameSlug?: string }): Promise<AuditEntry[]>;
  putInboxItem(i: InboxItem): Promise<void>;
  getInboxItem(id: string): Promise<InboxItem | undefined>;
  listInbox(status?: InboxStatus): Promise<InboxItem[]>;
  /** Compare-and-set: applies patch only if current status === expected. Returns false otherwise. */
  transitionInboxItem(id: string, expected: InboxStatus, patch: Partial<InboxItem>): Promise<boolean>;
  appendLedger(e: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry>;
  listLedger(f?: { gameSlug?: string; sinceIso?: string }): Promise<LedgerEntry[]>;
  /** Serializes fn against other calls with the same key (budget reservations). */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  putMetrics(m: MetricsSnapshot): Promise<void>;
  /** Latest snapshot per channel. */
  latestMetrics(slug: string): Promise<MetricsSnapshot[]>;
  /** Defaults to { killSwitch: { engaged: false } }. */
  getSettings(): Promise<Settings>;
  putSettings(s: Settings): Promise<void>;
}
