import type { Action } from '../domain/actions.js';

type Rule = (a: Action) => string | null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const RANDOM_REWARD_KINDS = new Set(['iap.change', 'price.change', 'balance.tweak']);
const OFFICIAL_VIA = new Set(['official_api', 'manual_by_operator']);

const rules: Rule[] = [
  (a) => {
    for (const flag of ['realMoneyPrize', 'crypto', 'cashValue']) {
      if (a.params[flag] === true) return `HR1: ${flag} is never allowed`;
    }
    return null;
  },
  (a) => {
    if (!RANDOM_REWARD_KINDS.has(a.kind) || a.params.randomReward !== true) return null;
    const odds = a.params.dropOdds;
    if (!isObj(odds)) return 'HR1: paid random reward without drop odds';
    const values = Object.values(odds);
    if (!values.every((v) => typeof v === 'number' && v >= 0 && v <= 1)) return 'HR1: drop odds must be fractions 0-1';
    const sum = (values as number[]).reduce((s, v) => s + v, 0);
    return Math.abs(sum - 1) <= 0.001 ? null : `HR1: drop odds sum to ${sum.toFixed(3)}, not 1`;
  },
  (a) => (a.kind === 'web.publish' && a.params.realPayments === true
    ? 'HR3: web builds may only use fake-door purchases'
    : null),
  (a) => {
    if (a.params.countdownResets === true) return 'HR4: a countdown that resets is a fake timer';
    if (a.params.syntheticClaimCount === true) return 'HR4: claim counts must be real, not synthetic';
    if (!('limitedDrop' in a.params)) return null;
    const d = a.params.limitedDrop;
    if (!isObj(d) || !Number.isInteger(d.cap) || (d.cap as number) <= 0) return 'HR4: limited drop needs a positive integer cap';
    const now = typeof a.params.now === 'number' ? a.params.now : Date.now();
    const ends = typeof d.endsAt === 'string' ? Date.parse(d.endsAt) : NaN;
    if (Number.isNaN(ends) || ends <= now) return 'HR4: limited drop needs a real end date in the future';
    return null;
  },
  (a) => ((a.kind === 'post.public' || a.kind === 'spend') && !OFFICIAL_VIA.has(String(a.params.via))
    ? `HR2: ${a.kind} must go via official_api or manual_by_operator (got ${String(a.params.via)})`
    : null),
  (a) => {
    if (a.kind !== 'spend') return null;
    if (typeof a.costUsd !== 'number' || !Number.isFinite(a.costUsd) || a.costUsd < 0) return 'spend needs a numeric costUsd >= 0';
    return a.gameSlug ? null : 'spend needs a gameSlug';
  },
];

/** Returns null if allowed, otherwise the first violated rule with its reason. */
export function checkHardRules(a: Action): string | null {
  for (const rule of rules) {
    const v = rule(a);
    if (v) return v;
  }
  return null;
}
