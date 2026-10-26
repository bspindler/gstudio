import type { MetricsChannel, MetricsSnapshot } from '../domain/types.js';
import type { StudioEvent } from '../events/schema.js';

const DAY_MS = 86400_000;
const utcDay = (ts: number) => Math.floor(ts / DAY_MS);

interface PlayerAcc { cohortDay: number; sessionStarts: Map<string, number>; sawOffer: boolean; intent: boolean; rating?: { ts: number; stars: number } }
interface SessionAcc { min: number; max: number; error: boolean }
interface ChannelAcc { players: Map<string, PlayerAcc>; sessions: Map<string, SessionAcc> }

/**
 * Turns raw events into one gate-ready snapshot per channel. Days are UTC; a cohort
 * counts toward Dn only once its day +n has fully finished before `asOf`. A return is a new session
 * starting on day +n, so one session that runs past UTC midnight is not a return.
 */
export function rollupMetrics(
  events: Iterable<StudioEvent>, opts: { game: string; asOf: Date },
): MetricsSnapshot[] {
  const cutoff = opts.asOf.getTime();
  const byChannel = new Map<MetricsChannel, ChannelAcc>();

  for (const e of events) {
    // Server time when present: a client clock can't backdate a cohort into maturity.
    const t = e.receivedAt ?? e.ts;
    if (e.game !== opts.game || t > cutoff) continue;
    let ch = byChannel.get(e.channel);
    if (!ch) byChannel.set(e.channel, (ch = { players: new Map(), sessions: new Map() }));

    const day = utcDay(t);
    let p = ch.players.get(e.playerId);
    if (!p) ch.players.set(e.playerId, (p = { cohortDay: day, sessionStarts: new Map(), sawOffer: false, intent: false }));
    p.cohortDay = Math.min(p.cohortDay, day);
    p.sessionStarts.set(e.sessionId, Math.min(p.sessionStarts.get(e.sessionId) ?? t, t));
    if (e.name === 'purchase_offer_shown') p.sawOffer = true;
    if (e.name === 'purchase_intent') p.intent = true;
    if (e.name === 'rating' && typeof e.props.stars === 'number' && (!p.rating || e.ts >= p.rating.ts)) {
      p.rating = { ts: e.ts, stars: e.props.stars };
    }

    const sk = `${e.playerId}:${e.sessionId}`;
    const s = ch.sessions.get(sk);
    if (!s) ch.sessions.set(sk, { min: e.ts, max: e.ts, error: e.name === 'error' });
    else { s.min = Math.min(s.min, e.ts); s.max = Math.max(s.max, e.ts); s.error ||= e.name === 'error'; }
  }

  const asOfDay = utcDay(cutoff);
  const returned = (p: PlayerAcc, n: number) => {
    const starts = [...p.sessionStarts.values()].sort((a, b) => a - b).slice(1);
    return starts.some((t) => utcDay(t) === p.cohortDay + n);
  };
  const retention = (players: PlayerAcc[], n: number) => {
    const mature = players.filter((p) => p.cohortDay + n < asOfDay);
    return { rate: mature.length ? mature.filter((p) => returned(p, n)).length / mature.length : null, cohort: mature.length };
  };

  return [...byChannel].map(([channel, ch]) => {
    const players = [...ch.players.values()];
    const sessions = [...ch.sessions.values()];
    const offered = players.filter((p) => p.sawOffer);
    const rated = players.flatMap((p) => (p.rating ? [p.rating.stars] : []));
    const r1 = retention(players, 1);
    const r7 = retention(players, 7);
    return {
      gameSlug: opts.game,
      channel,
      asOf: opts.asOf.toISOString(),
      players: players.length,
      d1: r1.rate,
      d7: r7.rate,
      d1Cohort: r1.cohort,
      d7Cohort: r7.cohort,
      avgSessionSec: sessions.reduce((a, s) => a + (s.max - s.min) / 1000, 0) / sessions.length,
      purchaseIntentRate: offered.length ? offered.filter((p) => p.intent).length / offered.length : null,
      avgRating: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
      ratingCount: rated.length,
      crashFreeRate: sessions.filter((s) => !s.error).length / sessions.length,
    };
  });
}
