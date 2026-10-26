import { describe, expect, it } from 'vitest';
import { evaluateGate } from '@studio/core';
import { game, metrics, repoPolicy } from './helpers.js';

const p = repoPolicy();
const now = new Date('2026-11-01T00:00:00Z');

describe('evaluateGate', () => {
  it('0->1 promotes at score 0.6, kills at 0.59, holds when missing', () => {
    const g = game({ stage: 0 });
    expect(evaluateGate(g, [], p, { now, conceptScore: 0.6 })).toMatchObject({ decision: 'promote', toStage: 1 });
    expect(evaluateGate(g, [], p, { now, conceptScore: 0.59 }).decision).toBe('kill');
    expect(evaluateGate(g, [], p, { now })).toMatchObject({ decision: 'hold', insufficientData: true });
  });

  it('1->2 holds unless qa and bot both pass', () => {
    const g = game({ stage: 1 });
    expect(evaluateGate(g, [], p, { now, qaPassed: true, botPlayable: true }).decision).toBe('promote');
    expect(evaluateGate(g, [], p, { now, qaPassed: true, botPlayable: false }).decision).toBe('hold');
    expect(evaluateGate(g, [], p, { now, qaPassed: false, botPlayable: false }).decision).toBe('hold');
  });

  it('2->3 promotes on portal D1 0.16 with 250 players and rating 4.0 over 25', () => {
    const e = evaluateGate(game(), [metrics()], p, { now });
    expect(e).toMatchObject({ decision: 'promote', fromStage: 2, toStage: 3, insufficientData: false });
    expect(e.checks.length).toBeGreaterThan(0);
  });

  it('2->3 own_site needs 0.30', () => {
    const e = evaluateGate(game(), [metrics({ channel: 'own_site', d1: 0.25 })], p, { now });
    expect(e).toMatchObject({ decision: 'hold', insufficientData: false });
  });

  it('2->3 holds when ratings are too few', () => {
    expect(evaluateGate(game(), [metrics({ ratingCount: 5 })], p, { now }).decision).toBe('hold');
  });

  it('2->3 holds when rating is too low', () => {
    expect(evaluateGate(game(), [metrics({ avgRating: 3.5 })], p, { now }).decision).toBe('hold');
  });

  it('2->3 kills clear failure', () => {
    expect(evaluateGate(game(), [metrics({ d1: 0.05, players: 300 })], p, { now }).decision).toBe('kill');
  });

  it('2->3 does not kill when one channel is above its kill line', () => {
    const e = evaluateGate(game(), [metrics({ d1: 0.05, players: 300 }), metrics({ channel: 'own_site', d1: 0.2, players: 50 })], p, { now });
    expect(e.decision).toBe('hold');
  });

  it('2->3 never kills on insufficient data', () => {
    expect(evaluateGate(game(), [metrics({ d1: 0.01, players: 150 })], p, { now }))
      .toMatchObject({ decision: 'hold', insufficientData: true });
  });

  it('2->3 stale metrics hold', () => {
    expect(evaluateGate(game(), [metrics({ asOf: '2026-10-27T00:00:00Z', d1: 0.01 })], p, { now }))
      .toMatchObject({ decision: 'hold', insufficientData: true });
  });

  it('2->3 with no metrics holds', () => {
    expect(evaluateGate(game(), [], p, { now })).toMatchObject({ decision: 'hold', insufficientData: true });
  });

  it('3->4 promotes on crash-free and store readiness, never kills', () => {
    const g = game({ stage: 3 });
    const store = metrics({ channel: 'store', crashFreeRate: 0.996 });
    expect(evaluateGate(g, [store], p, { now, storeReadiness: true }).decision).toBe('promote');
    expect(evaluateGate(g, [store], p, { now, storeReadiness: false }).decision).toBe('hold');
    expect(evaluateGate(g, [metrics({ channel: 'store', crashFreeRate: 0.9 })], p, { now, storeReadiness: true }).decision).toBe('hold');
  });

  it('4->5 promotes when LTV covers max CPI', () => {
    const store = metrics({ channel: 'store', d1: 0.36, d7: 0.13, players: 600 });
    const ve = (my: number) => ({ ltvUsd: 1.2, cpiUsdByMarket: { PH: 0.4, MY: my }, asOf: '2026-10-31T00:00:00Z', workings: '' });
    expect(evaluateGate(game({ stage: 4, valueEstimate: ve(0.9) }), [store], p, { now }).decision).toBe('promote');
    expect(evaluateGate(game({ stage: 4, valueEstimate: ve(1.3) }), [store], p, { now }).decision).toBe('hold');
  });

  it('4->5 missing value estimate is insufficient data', () => {
    const store = metrics({ channel: 'store', d1: 0.36, d7: 0.13, players: 600 });
    expect(evaluateGate(game({ stage: 4 }), [store], p, { now })).toMatchObject({ decision: 'hold', insufficientData: true });
  });

  it('4->5 low D7 holds', () => {
    const store = metrics({ channel: 'store', d1: 0.36, d7: 0.08, players: 600 });
    const ve = { ltvUsd: 2, cpiUsdByMarket: { PH: 0.4 }, asOf: '2026-10-31T00:00:00Z', workings: '' };
    expect(evaluateGate(game({ stage: 4, valueEstimate: ve }), [store], p, { now })).toMatchObject({ decision: 'hold', insufficientData: false });
  });

  it('stage 6 not evaluated yet', () => {
    expect(evaluateGate(game({ stage: 6 }), [], p, { now })).toMatchObject({
      decision: 'hold', toStage: null, checks: [{ name: 'not_evaluated', required: 'Phase 4' }],
    });
  });
});
