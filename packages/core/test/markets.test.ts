import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMarkets } from '@studio/core';

describe('markets', () => {
  it('loads repo markets.yaml', async () => {
    const m = await loadMarkets(fileURLToPath(new URL('../../../markets.yaml', import.meta.url)));
    expect(m.tiers.tier3.countries).toEqual(['PH', 'MY', 'TH', 'BR', 'MX']);
    expect(m.excluded.countries).toContain('VN');
  });
});
