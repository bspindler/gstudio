import { describe, expect, it } from 'vitest';
import type { ObjectStore, StudioEvent } from '@studio/core';
import { createApp } from '../src/app.js';

const NOW = new Date('2026-10-26T12:00:00Z');
const memObjects = () => {
  const m = new Map<string, string>();
  const store: ObjectStore = {
    async put(k, b) { m.set(k, b); },
    async get(k) { return m.get(k); },
    async list(p) { return [...m.keys()].filter((k) => k.startsWith(p)).sort(); },
  };
  return { m, store };
};
const ev = (o: Partial<StudioEvent> = {}): StudioEvent => ({
  v: 1, game: 'hyperline', version: '0.2.0', channel: 'own_site',
  playerId: '6f1c2b1e-8a4d-4c1e-9b7a-1d2e3f4a5b6c', sessionId: 's1', ts: NOW.getTime(),
  name: 'session_start', props: {}, ...o,
});
let n = 0;
const setup = () => {
  const objs = memObjects();
  const app = createApp({ objects: objs.store, clock: () => NOW, ids: () => `id${++n}`, allowedOrigins: ['http://localhost:5174'] });
  const post = (body: unknown, headers: Record<string, string> = {}) => app.request('/v1/events', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
  return { app, objs, post };
};

describe('POST /v1/events', () => {
  it('accepts a batch and writes NDJSON partitioned by day and game', async () => {
    const { objs, post } = setup();
    const res = await post({ events: [ev(), ev({ game: 'tidepool-pals' }), ev({ name: 'heartbeat' })] });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 3 });
    const keys = [...objs.m.keys()].sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^events\/day=2026-10-26\/game=hyperline\/id\d+\.ndjson$/);
    const lines = objs.m.get(keys[0]!)!.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.name)).toEqual(['session_start', 'heartbeat']);
  });

  it('partitions by the event day, not the server day', async () => {
    const { objs, post } = setup();
    await post({ events: [ev({ ts: NOW.getTime() - 86400_000 })] });
    expect([...objs.m.keys()][0]).toContain('day=2026-10-25');
  });

  it('rejects bodies over 64 KB with 413 and writes nothing', async () => {
    const { objs, post } = setup();
    const res = await post('x'.repeat(65 * 1024));
    expect(res.status).toBe(413);
    expect(objs.m.size).toBe(0);
  });

  it('rejects an invalid batch with 400 and writes nothing', async () => {
    const { objs, post } = setup();
    const res = await post({ events: [ev(), ev({ playerId: 'not-a-uuid' })] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/playerId/);
    expect(objs.m.size).toBe(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const { post } = setup();
    expect((await post('{nope')).status).toBe(400);
  });

  it('sends CORS headers only for allowed origins', async () => {
    const { post } = setup();
    const ok = await post({ events: [ev()] }, { origin: 'http://localhost:5174' });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5174');
    const bad = await post({ events: [ev()] }, { origin: 'https://evil.example' });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('stores nothing from request headers', async () => {
    const { objs, post } = setup();
    await post({ events: [ev()] }, { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'UA-MARKER' });
    const body = [...objs.m.values()].join('');
    expect(body).not.toContain('203.0.113.9');
    expect(body).not.toContain('UA-MARKER');
  });
});

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await setup().app.request('/healthz');
    expect(res.status).toBe(200);
  });
});
