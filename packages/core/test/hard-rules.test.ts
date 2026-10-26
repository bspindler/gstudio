import { describe, expect, it } from 'vitest';
import { checkHardRules, type Action } from '@studio/core';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const check = (a: Action) => checkHardRules(a, new Date(NOW));
const future = new Date(NOW + 7 * 864e5).toISOString();
const past = new Date(NOW - 864e5).toISOString();
const act = (a: Partial<Action> & Pick<Action, 'kind'>): Action => ({ requestedBy: 'system', ...a, params: { ...a.params } });

describe('checkHardRules', () => {
  describe('HR1 paid random rewards need odds', () => {
    for (const kind of ['iap.change', 'price.change', 'balance.tweak'] as const) {
      it(`${kind} without odds is rejected`, () => {
        expect(check(act({ kind, params: { randomReward: true } }))).toMatch(/^HR1/);
      });
      it(`${kind} with odds summing to 1 is allowed`, () => {
        expect(check(act({ kind, params: { randomReward: true, dropOdds: { common: 0.62, rare: 0.3, epic: 0.08 } } }))).toBeNull();
      });
    }
    it('odds that do not sum to 1 are rejected', () => {
      expect(check(act({ kind: 'iap.change', params: { randomReward: true, dropOdds: { a: 0.5, b: 0.4 } } }))).toMatch(/^HR1/);
    });
  });

  describe('HR1 no real-money prizes, crypto, or cash value', () => {
    for (const flag of ['realMoneyPrize', 'crypto', 'cashValue']) {
      it(`${flag} is rejected`, () => {
        expect(check(act({ kind: 'balance.tweak', params: { [flag]: true } }))).toMatch(/^HR1/);
      });
    }
    it('ordinary balance tweak is allowed', () => {
      expect(check(act({ kind: 'balance.tweak', params: { crateCost: 200 } }))).toBeNull();
    });
  });

  describe('HR3 web builds take no real payments', () => {
    it('web.publish with realPayments is rejected', () => {
      expect(check(act({ kind: 'web.publish', params: { realPayments: true } }))).toMatch(/^HR3/);
    });
    it('web.publish with fake-door purchases is allowed', () => {
      expect(check(act({ kind: 'web.publish', params: { realPayments: false } }))).toBeNull();
    });
  });

  describe('HR4 limited drops are real', () => {
    it('requires a positive integer cap', () => {
      expect(check(act({ kind: 'balance.tweak', params: { limitedDrop: { cap: 0, endsAt: future } } }))).toMatch(/^HR4/);
    });
    it('requires an end date in the future', () => {
      expect(check(act({ kind: 'balance.tweak', params: { limitedDrop: { cap: 5000, endsAt: past } } }))).toMatch(/^HR4/);
      expect(check(act({ kind: 'balance.tweak', params: { limitedDrop: { cap: 5000 } } }))).toMatch(/^HR4/);
    });
    it('a real drop is allowed', () => {
      expect(check(act({ kind: 'balance.tweak', params: { limitedDrop: { cap: 5000, endsAt: future } } }))).toBeNull();
    });
    it('fake scarcity from Hyperline prototype is rejected', () => {
      expect(check(act({ kind: 'balance.tweak', params: { limitedDrop: { cap: 5000, endsAt: future }, syntheticClaimCount: true } }))).toMatch(/^HR4/);
    });
    it('resetting countdowns are rejected', () => {
      expect(check(act({ kind: 'balance.tweak', params: { countdownResets: true } }))).toMatch(/^HR4/);
    });
  });

  describe('HR2 official channels only', () => {
    for (const kind of ['post.public', 'spend'] as const) {
      it(`${kind} without via is rejected`, () => {
        expect(check(act({ kind, gameSlug: 'g', costUsd: 1, params: {} }))).toMatch(/^HR2/);
      });
      it(`${kind} via a human-mimicking bot is rejected`, () => {
        expect(check(act({ kind, gameSlug: 'g', costUsd: 1, params: { via: 'browser_bot' } }))).toMatch(/^HR2/);
      });
      it(`${kind} via official_api is allowed`, () => {
        expect(check(act({ kind, gameSlug: 'g', costUsd: 1, params: { via: 'official_api' } }))).toBeNull();
      });
    }
    it('manual_by_operator posting is allowed', () => {
      expect(check(act({ kind: 'post.public', params: { via: 'manual_by_operator' } }))).toBeNull();
    });
  });

  describe('spend shape', () => {
    it('spend needs a numeric non-negative costUsd', () => {
      expect(check(act({ kind: 'spend', gameSlug: 'g', params: { via: 'official_api' } }))).toMatch(/costUsd/);
      expect(check(act({ kind: 'spend', gameSlug: 'g', costUsd: -1, params: { via: 'official_api' } }))).toMatch(/costUsd/);
    });
    it('spend needs a gameSlug', () => {
      expect(check(act({ kind: 'spend', costUsd: 5, params: { via: 'official_api' } }))).toMatch(/gameSlug/);
    });
  });
});
