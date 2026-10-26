import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';

const iso = z.string().regex(/^[A-Z]{2}$/);
const MarketTierSchema = z
  .object({
    purpose: z.string(),
    countries: z.array(iso),
    conditional: z.array(iso).optional(),
    optional: z.array(iso).optional(),
    localized_next: z.array(iso).optional(),
    platforms: z.array(z.enum(['ios', 'android'])),
    cpi_usd: z.record(z.tuple([z.number(), z.number()])),
    gates: z.record(z.number()).optional(),
    rationale: z.string(),
    notes: z.record(z.string()),
  })
  .passthrough();

const MarketsFileSchema = z.object({
  markets: z
    .object({
      excluded: z.object({ regions: z.array(z.string()), countries: z.array(iso) }),
      tiers: z.object({ tier3: MarketTierSchema, tier2: MarketTierSchema, tier1: MarketTierSchema }),
    })
    .passthrough(),
});

export type MarketTier = z.infer<typeof MarketTierSchema>;
export type Markets = z.infer<typeof MarketsFileSchema>['markets'];

export async function loadMarkets(path: string): Promise<Markets> {
  return MarketsFileSchema.parse(parse(await readFile(path, 'utf8'))).markets;
}
