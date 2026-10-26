import { z } from 'zod';
import { APPROVE_FLOOR } from '../domain/actions.js';

const cls = z.enum(['auto', 'notify', 'approve']);
const rate = z.number().min(0).max(1);
const usd = z.number().min(0);
const cap = z.object({ daily_usd: usd, total_usd: usd }).strict();
const byChannel = z.object({ portal: rate, own_site: rate }).strict();

const SIMPLE_KINDS = [
  'build', 'qa.run', 'clip.generate', 'draft.generate', 'data.analyze', 'report.file', 'web.publish',
  'balance.tweak', 'store.listing', 'store.submit', 'market.expand', 'price.change', 'iap.change',
  'account.create', 'spend',
] as const;

const actions = z
  .object({
    ...Object.fromEntries(SIMPLE_KINDS.map((k) => [k, cls])),
    'post.public': z.object({ default: cls, channels: z.record(cls) }).strict(),
    'stage.advance': z.record(z.string().regex(/^[0-7]->[0-7]$/, 'expected "from->to"'), cls),
    'stage.kill': z.object({ max_auto_stage: z.number().int().min(0) }).strict(),
  } as { [K in (typeof SIMPLE_KINDS)[number]]: typeof cls } & {
    'post.public': z.ZodObject<{ default: typeof cls; channels: z.ZodRecord<z.ZodString, typeof cls> }, 'strict'>;
    'stage.advance': z.ZodRecord<z.ZodString, typeof cls>;
    'stage.kill': z.ZodObject<{ max_auto_stage: z.ZodNumber }, 'strict'>;
  })
  .strict();

export const PolicySchema = z
  .object({
    version: z.literal(1),
    actions,
    gates: z
      .object({
        '0->1': z.object({ min_concept_score: rate }).strict(),
        '1->2': z.object({ require: z.array(z.enum(['qa_passed', 'bot_playable'])) }).strict(),
        '2->3': z
          .object({
            min_players: z.number().int().min(0),
            min_avg_rating: z.number().min(0).max(5),
            min_rating_count: z.number().int().min(0),
            d1: byChannel,
            kill_d1: byChannel,
            max_metrics_age_days: z.number().min(0),
          })
          .strict(),
        '3->4': z
          .object({
            min_crash_free: rate,
            require: z.array(z.enum(['store_readiness'])),
            min_players: z.number().int().min(0),
            max_metrics_age_days: z.number().min(0),
          })
          .strict(),
        '4->5': z
          .object({
            d1: rate,
            d7: rate,
            min_ltv_over_cpi: z.number().min(0),
            min_players: z.number().int().min(0),
            max_metrics_age_days: z.number().min(0),
          })
          .strict(),
        sunset: z.object({ consecutive_failing_cycles: z.number().int().min(1) }).strict(),
      })
      .strict(),
    budgets: z
      .object({
        overall: cap,
        per_game_default: cap,
        per_game: z.record(cap),
        claude: z.object({ monthly_usd: usd }).strict(),
      })
      .strict(),
    inbox: z.object({ escalate_after_hours: z.number().positive() }).strict(),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const kind of APPROVE_FLOOR) {
      const c = (p.actions as Record<string, unknown>)[kind];
      if (c !== 'approve') {
        ctx.addIssue({ code: 'custom', path: ['actions', kind], message: `below approve floor (got ${String(c)})` });
      }
    }
    if (p.actions['stage.kill'].max_auto_stage > 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions', 'stage.kill', 'max_auto_stage'],
        message: 'stage.kill at stage 3+ is on the approve floor; max_auto_stage must be <= 2',
      });
    }
  });

export type Policy = z.infer<typeof PolicySchema>;
