import type { Stage } from './types.js';

export const ACTION_KINDS = [
  'build', 'qa.run', 'clip.generate', 'draft.generate', 'data.analyze', 'report.file',
  'stage.advance', 'stage.kill', 'web.publish', 'balance.tweak', 'spend', 'post.public', 'store.listing',
  'store.submit', 'market.expand', 'price.change', 'iap.change', 'account.create',
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionClass = 'auto' | 'notify' | 'approve';

export interface Action {
  kind: ActionKind;
  gameSlug?: string;
  params: Record<string, unknown>;
  costUsd?: number;
  channel?: string;
  fromStage?: Stage;
  toStage?: Stage;
  requestedBy: 'system' | 'operator';
  rationale?: string;
}

/** Kinds that policy.yaml can never classify below `approve`. stage.kill at stage >= 3 is enforced separately. */
export const APPROVE_FLOOR: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'spend', 'store.submit', 'market.expand', 'price.change', 'iap.change', 'account.create',
]);

export const isActionKind = (k: string): k is ActionKind => (ACTION_KINDS as readonly string[]).includes(k);
