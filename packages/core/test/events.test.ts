import { describe, expect, it } from 'vitest';
import { parseEventBatch, type StudioEvent } from '../src/index.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const ev = (o: Partial<StudioEvent> = {}): StudioEvent => ({
  v: 1, game: 'tidepool-pals', version: '0.2.0', channel: 'own_site',
  playerId: '6f1c2b1e-8a4d-4c1e-9b7a-1d2e3f4a5b6c', sessionId: 's1', ts: NOW,
  name: 'level_end', props: { level: 3, result: 'win', score: 1200 }, ...o,
});
const parse = (events: unknown[]) => parseEventBatch({ events }, NOW);

describe('parseEventBatch', () => {
  it('accepts a valid batch', () => {
    const r = parse([ev(), ev({ name: 'session_start', props: {} })]);
    expect(r.ok && r.events).toHaveLength(2);
  });
  it('rejects more than 100 events', () => {
    expect(parse(Array.from({ length: 101 }, () => ev())).ok).toBe(false);
  });
  it('rejects nested object props', () => {
    expect(parse([ev({ props: { a: { b: 1 } } as never })]).ok).toBe(false);
  });
  it('rejects more than 20 props', () => {
    const props = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(parse([ev({ props })]).ok).toBe(false);
  });
  it('rejects string props longer than 200 chars', () => {
    expect(parse([ev({ props: { s: 'x'.repeat(201) } })]).ok).toBe(false);
  });
  it('requires a slug-shaped game', () => {
    expect(parse([ev({ game: 'Tide Pool' })]).ok).toBe(false);
  });
  it('requires a UUID player id', () => {
    expect(parse([ev({ playerId: 'brian@example.com' })]).ok).toBe(false);
  });
  it('rejects unknown event names', () => {
    expect(parse([ev({ name: 'email_captured' as never })]).ok).toBe(false);
  });
  it('requires integer stars 1-5 on rating', () => {
    expect(parse([ev({ name: 'rating', props: { stars: 5 } })]).ok).toBe(true);
    expect(parse([ev({ name: 'rating', props: { stars: 6 } })]).ok).toBe(false);
    expect(parse([ev({ name: 'rating', props: { stars: 4.5 } })]).ok).toBe(false);
    expect(parse([ev({ name: 'rating', props: {} })]).ok).toBe(false);
  });
  it('rejects timestamps more than 7 days from now', () => {
    expect(parse([ev({ ts: NOW - 8 * 86400_000 })]).ok).toBe(false);
    expect(parse([ev({ ts: NOW + 8 * 86400_000 })]).ok).toBe(false);
  });
  it('rejects a non-object body', () => {
    expect(parseEventBatch('nope', NOW).ok).toBe(false);
    expect(parseEventBatch({ events: [] }, NOW).ok).toBe(false);
  });
});
