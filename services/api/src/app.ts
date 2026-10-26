import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { parseEventBatch, type ObjectStore, type StudioEvent } from '@studio/core';

export interface ApiDeps {
  objects: ObjectStore;
  clock: () => Date;
  ids: () => string;
  allowedOrigins: string[];
}

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * The API + ingest app. Runs on Node locally and inside a Functions adapter in Azure.
 * Privacy-light: nothing from request headers (IP, user agent) is stored.
 */
export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  app.use('/v1/*', cors({
    origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['content-type'],
    maxAge: 86400,
  }));

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post(
    '/v1/events',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'body too large' }, 413) }),
    async (c) => {
      let body: unknown;
      try { body = JSON.parse(await c.req.text()); } catch { return c.json({ error: 'invalid JSON' }, 400); }

      const parsed = parseEventBatch(body, deps.clock().getTime());
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);

      const groups = new Map<string, StudioEvent[]>();
      for (const e of parsed.events) {
        const key = `events/day=${new Date(e.ts).toISOString().slice(0, 10)}/game=${e.game}`;
        groups.set(key, [...(groups.get(key) ?? []), e]);
      }
      await Promise.all([...groups].map(([prefix, events]) =>
        deps.objects.put(`${prefix}/${deps.ids()}.ndjson`, events.map((e) => JSON.stringify(e)).join('\n') + '\n')));

      return c.json({ accepted: parsed.events.length }, 202);
    },
  );

  return app;
}
