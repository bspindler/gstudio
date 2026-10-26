import {
  loadGameLibrary, rollupMetrics,
  type Game, type MetricsSnapshot, type ObjectStore, type RegistryStore, type StudioEvent,
} from '@studio/core';

export { simulatePlayers } from './simulate.js';

/**
 * Creates a registry record for every library game that doesn't have one yet. Ported prototypes
 * are already playable, so they enter at stage 2 (web test). Returns the slugs it created.
 */
export async function seedLibrary(store: RegistryStore, gamesDir: string, now: Date): Promise<string[]> {
  const created: string[] = [];
  for (const m of await loadGameLibrary(gamesDir)) {
    if (await store.getGame(m.slug)) continue;
    const at = now.toISOString();
    const game: Game = {
      slug: m.slug, title: m.title, genre: m.genre, targetSegment: m.targetSegment, stage: 2, markets: [],
      versions: [{ version: m.version, createdAt: at, notes: 'seeded from games/' }],
      ageRating: m.ageRating, storeIds: {}, valueEstimate: null, failingCycles: 0, createdAt: at, updatedAt: at,
    };
    await store.putGame(game);
    await store.appendAudit({ at, actor: 'system', gameSlug: m.slug, type: 'game.seeded', summary: `seeded at stage 2 (v${m.version})`, data: { meta: m } });
    created.push(m.slug);
  }
  return created;
}

async function* readEvents(objects: ObjectStore, game: string, asOf: Date): AsyncGenerator<StudioEvent> {
  const lastDay = asOf.toISOString().slice(0, 10);
  for (const key of await objects.list('events/')) {
    const m = /^events\/day=(\d{4}-\d{2}-\d{2})\/game=([a-z0-9-]+)\//.exec(key);
    if (!m || m[2] !== game || m[1]! > lastDay) continue;
    const body = (await objects.get(key)) ?? '';
    for (const line of body.split('\n')) if (line) yield JSON.parse(line) as StudioEvent;
  }
}

/** Nightly job: raw events -> one MetricsSnapshot per game and channel, written to the registry. */
export async function runRollup(d: {
  objects: ObjectStore; store: RegistryStore; asOf: Date; games: string[];
}): Promise<MetricsSnapshot[]> {
  const out: MetricsSnapshot[] = [];
  for (const game of d.games) {
    const events: StudioEvent[] = [];
    for await (const e of readEvents(d.objects, game, d.asOf)) events.push(e);
    for (const s of rollupMetrics(events, { game, asOf: d.asOf })) {
      await d.store.putMetrics(s);
      out.push(s);
    }
  }
  return out;
}
