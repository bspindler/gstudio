import { describe, expect, it } from 'vitest';
import { rollupMetrics, type EventName, type StudioEvent } from '../src/index.js';

const DAY = 86400_000;
const T0 = Date.parse('2026-10-01T10:00:00Z');
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let seq = 0;
const e = (
  player: number, dayOffset: number, name: EventName = 'heartbeat',
  o: Partial<StudioEvent> = {},
): StudioEvent => ({
  v: 1, game: 'g', version: '1', channel: 'own_site', playerId: pid(player),
  sessionId: `p${player}d${dayOffset}`, ts: T0 + dayOffset * DAY + (seq++ % 1000), name, props: {}, ...o,
});
const at = (days: number) => new Date(T0 + days * DAY);
const only = (events: StudioEvent[], asOfDays: number) => {
  const r = rollupMetrics(events, { game: 'g', asOf: at(asOfDays) });
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe('rollupMetrics', () => {
  it('counts distinct players and stamps asOf', () => {
    const s = only([e(1, 0), e(1, 0), e(2, 0)], 1);
    expect(s.players).toBe(2);
    expect(s.gameSlug).toBe('g');
    expect(s.asOf).toBe(at(1).toISOString());
  });

  it('computes D1 over mature cohorts only', () => {
    // p1 returns on day 1, p2 does not; p3 and p4 are immature at asOf day 2
    // (p4's return day, day 2, has not finished yet)
    const s = only([e(1, 0), e(1, 1), e(2, 0), e(3, 2), e(4, 1)], 2);
    expect(s.d1).toBe(0.5);
  });

  it('returns null D1 and D7 when no cohort is mature', () => {
    const s = only([e(1, 0), e(2, 0)], 0.5);
    expect(s.d1).toBeNull();
    expect(s.d7).toBeNull();
  });

  it('computes D7 from cohorts whose day +7 has finished, on exactly day +7', () => {
    const s = only([e(1, 0), e(1, 7), e(2, 0), e(2, 6), e(3, 1)], 8);
    expect(s.d7).toBe(0.5); // p1 yes, p2 no (day 6 only); p3 cohort day 1 not mature
  });

  it('splits channels independently', () => {
    const r = rollupMetrics(
      [e(1, 0), e(1, 1), e(1, 0, 'heartbeat', { channel: 'portal' })],
      { game: 'g', asOf: at(2) },
    );
    const byCh = Object.fromEntries(r.map((s) => [s.channel, s]));
    expect(byCh.own_site!.d1).toBe(1);
    expect(byCh.portal!.d1).toBe(0);
    expect(byCh.portal!.players).toBe(1);
  });

  it('averages session length from first to last event', () => {
    const s = only([
      e(1, 0, 'session_start', { sessionId: 'a', ts: T0 }),
      e(1, 0, 'session_end', { sessionId: 'a', ts: T0 + 120_000 }),
      e(2, 0, 'session_start', { sessionId: 'b', ts: T0 }),
    ], 1);
    expect(s.avgSessionSec).toBe(60);
  });

  it('computes purchase intent among players who saw an offer', () => {
    const s = only([
      e(1, 0, 'purchase_offer_shown'), e(1, 0, 'purchase_intent'),
      e(2, 0, 'purchase_offer_shown'), e(2, 0, 'purchase_declined'),
      e(3, 0),
    ], 1);
    expect(s.purchaseIntentRate).toBe(0.5);
  });

  it('returns null purchase intent when no offer was shown', () => {
    expect(only([e(1, 0)], 1).purchaseIntentRate).toBeNull();
  });

  it("uses each player's latest rating", () => {
    const s = only([
      e(1, 0, 'rating', { props: { stars: 2 } }),
      e(1, 0.5, 'rating', { props: { stars: 4 } }),
      e(2, 0, 'rating', { props: { stars: 5 } }),
    ], 1);
    expect(s.ratingCount).toBe(2);
    expect(s.avgRating).toBe(4.5);
  });

  it('reports null rating with zero count when nobody rated', () => {
    const s = only([e(1, 0)], 1);
    expect(s.avgRating).toBeNull();
    expect(s.ratingCount).toBe(0);
  });

  it('computes crash-free rate per session', () => {
    const s = only([
      e(1, 0, 'heartbeat', { sessionId: 'a' }), e(1, 0, 'error', { sessionId: 'a' }),
      e(2, 0, 'heartbeat', { sessionId: 'b' }), e(3, 0, 'heartbeat', { sessionId: 'c' }),
      e(4, 0, 'heartbeat', { sessionId: 'd' }),
    ], 1);
    expect(s.crashFreeRate).toBe(0.75);
  });

  it('ignores events after asOf and events for other games', () => {
    const r = rollupMetrics([e(1, 0), e(2, 5), e(3, 0, 'heartbeat', { game: 'other' })], { game: 'g', asOf: at(1) });
    expect(r[0]!.players).toBe(1);
  });

  it('returns nothing for a game with no events', () => {
    expect(rollupMetrics([], { game: 'g', asOf: at(1) })).toEqual([]);
  });
});
