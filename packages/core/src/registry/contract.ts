import { describe, expect, it } from 'vitest';
import type { Game, InboxItem, MetricsSnapshot } from '../domain/types.js';
import type { RegistryStore } from './store.js';

export const sampleGame = (slug = 'tidepool-pals'): Game => ({
  slug, title: 'Tidepool Pals', genre: 'match-3', targetSegment: 'casual 13+', stage: 1, markets: [],
  versions: [{ version: '0.1.0', createdAt: '2026-10-25T00:00:00Z', notes: 'prototype' }],
  ageRating: null, storeIds: {}, valueEstimate: null, failingCycles: 0,
  createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z',
});

const sampleItem = (id: string): InboxItem => ({
  id, createdAt: '2026-10-25T00:00:00Z', status: 'pending',
  action: { kind: 'store.submit', params: {}, requestedBy: 'system' },
  title: 'Submit', recommendation: 'Approve', keyNumbers: [],
});

const snap = (channel: MetricsSnapshot['channel'], asOf: string, players: number): MetricsSnapshot => ({
  gameSlug: 'g', channel, asOf, players, d1: 0.2, d7: null, d1Cohort: players, d7Cohort: 0, avgSessionSec: 60,
  purchaseIntentRate: null, avgRating: 4, ratingCount: 10, crashFreeRate: null,
});

const allMethodNames = (o: object): string[] => {
  const names = new Set<string>();
  for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    Object.getOwnPropertyNames(p).forEach((n) => names.add(n));
  }
  Object.keys(o).forEach((n) => names.add(n));
  return [...names];
};

/** Shared vitest suite that every RegistryStore adapter must pass. */
export function registryStoreContract(name: string, make: () => Promise<RegistryStore>): void {
  describe(`RegistryStore contract: ${name}`, () => {
    it('game round-trip clones on read and write', async () => {
      const s = await make();
      const g = sampleGame();
      await s.putGame(g);
      g.title = 'mutated after put';
      const got = await s.getGame('tidepool-pals');
      expect(got?.title).toBe('Tidepool Pals');
      got!.title = 'mutated after get';
      expect((await s.getGame('tidepool-pals'))?.title).toBe('Tidepool Pals');
      expect(await s.listGames()).toHaveLength(1);
    });

    it('audit is append-only and ordered', async () => {
      const s = await make();
      for (const t of ['a', 'b', 'c']) {
        await s.appendAudit({ at: '2026-10-25T00:00:00Z', actor: 'system', type: t, summary: t, data: {} });
      }
      const all = await s.listAudit();
      expect(all.map((e) => e.type)).toEqual(['a', 'b', 'c']);
      expect(new Set(all.map((e) => e.id)).size).toBe(3);
      const auditMethods = allMethodNames(s).filter((n) => /audit/i.test(n));
      expect(auditMethods.sort()).toEqual(['appendAudit', 'listAudit']);
    });

    it('filters audit by game', async () => {
      const s = await make();
      await s.appendAudit({ at: 't', actor: 'system', gameSlug: 'x', type: 'a', summary: '', data: {} });
      await s.appendAudit({ at: 't', actor: 'system', gameSlug: 'y', type: 'b', summary: '', data: {} });
      expect((await s.listAudit({ gameSlug: 'y' })).map((e) => e.type)).toEqual(['b']);
    });

    it('transitionInboxItem is compare-and-set', async () => {
      const s = await make();
      await s.putInboxItem(sampleItem('i1'));
      expect(await s.transitionInboxItem('i1', 'pending', { status: 'approved' })).toBe(true);
      expect(await s.transitionInboxItem('i1', 'pending', { status: 'approved' })).toBe(false);
      expect((await s.getInboxItem('i1'))?.status).toBe('approved');
      expect(await s.listInbox('pending')).toHaveLength(0);
      expect(await s.transitionInboxItem('missing', 'pending', { status: 'approved' })).toBe(false);
    });

    it('withLock serializes calls with the same key', async () => {
      const s = await make();
      const log: string[] = [];
      const job = (n: string) => s.withLock('b', async () => {
        log.push(`${n}-start`);
        await new Promise((r) => setTimeout(r, 10));
        log.push(`${n}-end`);
      });
      await Promise.all([job('a'), job('b')]);
      expect(log).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    });

    it('withLock releases after a throwing fn', async () => {
      const s = await make();
      await expect(s.withLock('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      expect(await s.withLock('k', async () => 42)).toBe(42);
    });

    it('ledger append and filter', async () => {
      const s = await make();
      await s.appendLedger({ at: '2026-10-25T10:00:00Z', gameSlug: 'g', amountUsd: 5, kind: 'reserve', reservationId: 'r1' });
      await s.appendLedger({ at: '2026-10-26T10:00:00Z', gameSlug: 'h', amountUsd: 7, kind: 'reserve', reservationId: 'r2' });
      expect(await s.listLedger({ gameSlug: 'g' })).toHaveLength(1);
      expect((await s.listLedger({ sinceIso: '2026-10-26T00:00:00Z' })).map((e) => e.reservationId)).toEqual(['r2']);
    });

    it('latestMetrics returns newest per channel', async () => {
      const s = await make();
      await s.putMetrics(snap('portal', '2026-10-24T00:00:00Z', 10));
      await s.putMetrics(snap('portal', '2026-10-25T00:00:00Z', 20));
      await s.putMetrics(snap('own_site', '2026-10-23T00:00:00Z', 5));
      const latest = await s.latestMetrics('g');
      expect(latest).toHaveLength(2);
      expect(latest.find((m) => m.channel === 'portal')?.players).toBe(20);
    });

    it('settings default to kill switch off', async () => {
      const s = await make();
      expect(await s.getSettings()).toEqual({ killSwitch: { engaged: false } });
      await s.putSettings({ killSwitch: { engaged: true, by: 'brian' } });
      expect((await s.getSettings()).killSwitch.engaged).toBe(true);
    });
  });
}
