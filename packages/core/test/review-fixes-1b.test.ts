import { describe, expect, it } from 'vitest';
import { evaluateGate, rollupMetrics, type StudioEvent } from '@studio/core';
import { game, metrics, repoPolicy } from './helpers.js';

const p = repoPolicy();
const now = new Date('2026-11-01T00:00:00Z');
const DAY = 86400_000;
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('C1: gate D1 sample size is the mature cohort, not all players', () => {
  it('rollup reports the mature cohort sizes', () => {
    const t0 = Date.parse('2026-10-30T12:00:00Z');
    const ev = (n: number, ts: number): StudioEvent => ({
      v: 1, game: 'g', version: '1', channel: 'portal', playerId: pid(n), sessionId: `s${n}-${ts}`, ts, name: 'heartbeat', props: {},
    });
    // 10 players two days ago (mature), 240 yesterday (not mature)
    const events = [
      ...Array.from({ length: 10 }, (_, i) => ev(i, t0)),
      ...Array.from({ length: 240 }, (_, i) => ev(100 + i, t0 + DAY)),
    ];
    const [s] = rollupMetrics(events, { game: 'g', asOf: now });
    expect(s).toMatchObject({ players: 250, d1: 0, d1Cohort: 10, d7: null, d7Cohort: 0 });
  });

  it('does not kill on a 10-player mature cohort even when 250 players exist', () => {
    const e = evaluateGate(game(), [metrics({ players: 250, d1: 0, d1Cohort: 10 })], p, { now });
    expect(e.decision).toBe('hold');
  });

  it('does not promote on a small lucky cohort', () => {
    const e = evaluateGate(game(), [metrics({ players: 250, d1: 0.6, d1Cohort: 12 })], p, { now });
    expect(e.decision).toBe('hold');
    expect(e.checks.find((c) => c.name === 'd1_portal')?.actual).toContain('n=12');
  });

  it('soft launch holds as insufficient when the D7 cohort is small', () => {
    const ve = { ltvUsd: 2, cpiUsdByMarket: { PH: 0.4 }, asOf: '2026-10-31T00:00:00Z', workings: '' };
    const store = metrics({ channel: 'store', d1: 0.4, d7: 0.2, players: 600, d1Cohort: 600, d7Cohort: 40 });
    expect(evaluateGate(game({ stage: 4, valueEstimate: ve }), [store], p, { now }))
      .toMatchObject({ decision: 'hold', insufficientData: true });
  });
});

describe('I1: a session crossing UTC midnight is not a D1 return', () => {
  const base = Date.parse('2026-10-29T23:58:00Z');
  const ev = (sessionId: string, ts: number): StudioEvent => ({
    v: 1, game: 'g', version: '1', channel: 'own_site', playerId: pid(1), sessionId, ts, name: 'heartbeat', props: {},
  });

  it('one session 23:58-00:01 counts as not returned', () => {
    const [s] = rollupMetrics([ev('a', base), ev('a', base + 3 * 60_000)], { game: 'g', asOf: now });
    expect(s!.d1).toBe(0);
  });

  it('a new session on day 1 counts as returned', () => {
    const [s] = rollupMetrics([ev('a', base), ev('b', base + 12 * 3600_000)], { game: 'g', asOf: now });
    expect(s!.d1).toBe(1);
  });
});

describe('I3: day maths use the server receive time when present', () => {
  it('a backdated event received today is an immature cohort', () => {
    const today = Date.parse('2026-10-31T10:00:00Z');
    const e: StudioEvent = {
      v: 1, game: 'g', version: '1', channel: 'portal', playerId: pid(1), sessionId: 'a',
      ts: today - 5 * DAY, receivedAt: today, name: 'heartbeat', props: {},
    };
    const [s] = rollupMetrics([e], { game: 'g', asOf: now });
    expect(s).toMatchObject({ d1: null, d1Cohort: 0 });
  });
});
