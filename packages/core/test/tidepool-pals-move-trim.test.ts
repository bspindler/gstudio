import { describe, expect, it } from 'vitest';
import { levelDef, validateLevel } from '../../../games/tidepool-pals/levels.js';

describe('tidepool-pals move trim', () => {
  it('takes 2 moves back on the levels won with the most to spare, and stays valid', () => {
    expect([3, 4, 6, 7, 10, 17].map((n) => levelDef(n).moves)).toEqual([20, 20, 20, 20, 22, 26]);
    for (const n of [3, 4, 6, 7, 10, 17]) expect(validateLevel(levelDef(n))).toEqual([]);
  });
  it('leaves the levels that once walled players alone', () => {
    expect([11, 14, 15, 19].map((n) => levelDef(n).moves)).toEqual([40, 42, 34, 34]);
  });
});
