export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const STAGE_NAMES = [
  'concept', 'prototype', 'web_test', 'beta', 'soft_launch', 'expansion', 'live_ops', 'sunset',
] as const;

import type { Action } from './actions.js';

export interface Game {
  slug: string;
  title: string;
  genre: string;
  targetSegment: string;
  stage: Stage;
  /** ISO country codes where the game is live. */
  markets: string[];
  versions: { version: string; createdAt: string; notes: string }[];
  ageRating: string | null;
  storeIds: { appStore?: string; play?: string; crazygames?: string; itch?: string };
  valueEstimate: { ltvUsd: number; cpiUsdByMarket: Record<string, number>; asOf: string; workings: string } | null;
  failingCycles: number;
  createdAt: string;
  updatedAt: string;
}

export type MetricsChannel = 'portal' | 'own_site' | 'store';

export interface MetricsSnapshot {
  gameSlug: string;
  channel: MetricsChannel;
  asOf: string;
  players: number;
  d1: number | null;
  d7: number | null;
  avgSessionSec: number | null;
  purchaseIntentRate: number | null;
  avgRating: number | null;
  ratingCount: number;
  crashFreeRate: number | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: 'system' | 'operator' | 'claude';
  gameSlug?: string;
  type: string;
  summary: string;
  data: Record<string, unknown>;
}

export type InboxStatus = 'pending' | 'approved' | 'rejected';

export interface InboxItem {
  id: string;
  createdAt: string;
  status: InboxStatus;
  action: Action;
  title: string;
  recommendation: string;
  keyNumbers: { label: string; value: string }[];
  decision?: {
    at: string;
    by: string;
    choice: 'approve' | 'reject' | 'modify';
    modifiedParams?: Record<string, unknown>;
  };
  escalatedAt?: string;
}

export interface LedgerEntry {
  id: string;
  at: string;
  gameSlug: string | null;
  amountUsd: number;
  kind: 'reserve' | 'release' | 'actual';
  reservationId: string;
}

export interface Settings {
  killSwitch: { engaged: boolean; at?: string; by?: string };
}
