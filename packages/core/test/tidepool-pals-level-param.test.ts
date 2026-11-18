import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { levelFromSearch } from '../../../games/tidepool-pals/levels.js';

const COUNT = 29; // the highest hand-built level, the octopus pool
describe('tidepool ?level=N', () => {
  it('accepts whole numbers from 1 to the level count', () => {
    expect(levelFromSearch('?level=24')).toBe(24);
    expect(levelFromSearch('?level=1')).toBe(1);
    expect(levelFromSearch(`?level=${COUNT}`)).toBe(COUNT);
  });
  it('ignores everything else', () => {
    for (const s of ['', '?level=0', `?level=${COUNT + 1}`, '?level=-3', '?level=2.5', '?level=abc', '?level=', '?x=1', '?level=1e1'])
      expect(levelFromSearch(s)).toBeNull();
  });
});
