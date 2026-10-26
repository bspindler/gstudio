import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePolicy, type Policy } from '@studio/core';

export const repoPolicyYaml = readFileSync(fileURLToPath(new URL('../../../policy.yaml', import.meta.url)), 'utf8');
export const repoPolicy = (): Policy => parsePolicy(repoPolicyYaml);

export const policyWithBudgets = (b: Partial<Policy['budgets']>): Policy => {
  const p = repoPolicy();
  return { ...p, budgets: { ...p.budgets, ...b } };
};

export const seq = (prefix = 'id') => { let n = 0; return () => `${prefix}${++n}`; };

import type { Game, MetricsSnapshot } from '@studio/core';

export const game = (over: Partial<Game> = {}): Game => ({
  slug: 'g', title: 'G', genre: 'casual', targetSegment: '13+', stage: 2, markets: [], versions: [],
  ageRating: null, storeIds: {}, valueEstimate: null, failingCycles: 0,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over,
});

export const metrics = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  gameSlug: 'g', channel: 'portal', asOf: '2026-10-31T12:00:00Z', players: 250, d1: 0.16, d7: null,
  avgSessionSec: 120, purchaseIntentRate: null, avgRating: 4.0, ratingCount: 25, crashFreeRate: null, ...over,
});
