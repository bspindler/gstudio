import { z } from 'zod';

export const EVENT_NAMES = [
  'session_start', 'heartbeat', 'session_end', 'level_start', 'level_end',
  'purchase_offer_shown', 'purchase_intent', 'purchase_declined',
  'rating', 'exposure', 'error', 'custom',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const MAX_BATCH_EVENTS = 100;
const MAX_SKEW_MS = 7 * 86400_000;

type PropValue = string | number | boolean | null;

export interface StudioEvent {
  v: 1;
  game: string;
  version: string;
  channel: 'portal' | 'own_site' | 'store';
  playerId: string;
  sessionId: string;
  ts: number;
  name: EventName;
  props: Record<string, PropValue>;
}

const propValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

const eventSchema = z.object({
  v: z.literal(1),
  game: z.string().regex(/^[a-z0-9-]{1,40}$/),
  version: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
  channel: z.enum(['portal', 'own_site', 'store']),
  playerId: z.string().uuid(),
  sessionId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  ts: z.number().int(),
  name: z.enum(EVENT_NAMES),
  props: z.record(z.string().max(40), propValue)
    .refine((p) => Object.keys(p).length <= 20, 'at most 20 props'),
}).strict().superRefine((e, ctx) => {
  if (e.name === 'rating') {
    const s = e.props.stars;
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 5) {
      ctx.addIssue({ code: 'custom', path: ['props', 'stars'], message: 'stars must be an integer 1-5' });
    }
  }
});

const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(MAX_BATCH_EVENTS) }).strict();

export function parseEventBatch(
  body: unknown, now: number,
): { ok: true; events: StudioEvent[] } | { ok: false; error: string } {
  const r = batchSchema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0]!;
    return { ok: false, error: `${i.path.join('.') || '(root)'}: ${i.message}` };
  }
  const late = r.data.events.findIndex((e) => Math.abs(e.ts - now) > MAX_SKEW_MS);
  if (late >= 0) return { ok: false, error: `events.${late}.ts: more than 7 days from server time` };
  return { ok: true, events: r.data.events as StudioEvent[] };
}
