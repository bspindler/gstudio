import { describe, expect, it } from 'vitest';
import { sectorFromSearch, MAX_URL_SECTOR } from '../../../games/hyperline/lib/meta.js';

describe('hyperline ?sector=N', () => {
  it('reads a whole sector number', () => {
    expect(sectorFromSearch('?sector=5')).toBe(5);
    expect(sectorFromSearch('?hal&sector=12')).toBe(12);
    expect(sectorFromSearch(`?sector=${MAX_URL_SECTOR}`)).toBe(MAX_URL_SECTOR);
  });
  it('ignores missing and out-of-range values', () => {
    for (const s of ['', '?', '?sector=', '?sector=0', '?sector=-3', '?sector=2.5', '?sector=abc', '?sector=100', '?sector=99999', '?sector=1e1'])
      expect(sectorFromSearch(s)).toBe(0);
  });
});
