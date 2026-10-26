import type { StudioEvent } from '@studio/core';

// Synthetic players for local tests and demos only. Never point this at a real ingest:
// fake engagement on a real channel would break hard rule 2.

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uuidFrom = (r: () => number) => {
  const h = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16));
  h[12] = '4';
  h[16] = '89ab'[Math.floor(r() * 4)]!;
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

/**
 * Yields one ingest batch per player session. Exactly round(players * d1) players come back on
 * day 1, and round(players * ratingShare) leave a rating, so tests can assert exact rates.
 */
export function* simulatePlayers(o: {
  game: string; version: string; players: number; d1: number; ratingShare: number;
  stars: number[]; start: number; seed: number; channel?: StudioEvent['channel'];
}): Generator<{ events: StudioEvent[] }> {
  const r = mulberry32(o.seed);
  const returning = Math.round(o.players * o.d1);
  const raters = Math.round(o.players * o.ratingShare);
  for (let i = 0; i < o.players; i++) {
    const playerId = uuidFrom(r);
    const firstAt = o.start + Math.floor(r() * 6 * HOUR);
    const session = (at: number, rate: boolean): { events: StudioEvent[] } => {
      const sessionId = uuidFrom(r);
      let ts = at;
      const ev = (name: StudioEvent['name'], props: StudioEvent['props'] = {}): StudioEvent =>
        ({ v: 1, game: o.game, version: o.version, channel: o.channel ?? 'own_site', playerId, sessionId, ts: (ts += 5_000 + Math.floor(r() * 40_000)), name, props });
      const events = [ev('session_start')];
      const levels = 1 + Math.floor(r() * 4);
      for (let l = 1; l <= levels; l++) {
        events.push(ev('level_start', { level: l }), ev('heartbeat'), ev('level_end', { level: l, result: r() < 0.6 ? 'win' : 'lose', score: Math.floor(r() * 5000) }));
      }
      if (r() < 0.3) {
        events.push(ev('purchase_offer_shown', { sku: 'demo-sku', priceUsd: 0.99 }));
        events.push(r() < 0.15 ? ev('purchase_intent', { sku: 'demo-sku', priceUsd: 0.99 }) : ev('purchase_declined', { sku: 'demo-sku' }));
      }
      if (rate) events.push(ev('rating', { stars: o.stars[i % o.stars.length]! }));
      events.push(ev('session_end'));
      return { events };
    };
    yield session(firstAt, false);
    if (i < returning) yield session(firstAt + DAY, i < raters);
    else if (i < raters) yield session(firstAt + 2 * HOUR, true);
  }
}
