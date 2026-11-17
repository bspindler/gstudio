import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS module without a declaration file
import { startIndexFromSearch } from '../../../games/gearhold/startlink.js';

describe('gearhold ?level=N start link', () => {
  it('reads a 1-based level as a 0-based index', () => {
    expect(startIndexFromSearch('?level=1', 5)).toBe(0);
    expect(startIndexFromSearch('?level=3', 5)).toBe(2);
    expect(startIndexFromSearch('?x=1&level=5', 5)).toBe(4);
  });
  it('clamps to the real level count', () => {
    expect(startIndexFromSearch('?level=99', 5)).toBe(4);
    expect(startIndexFromSearch('?level=0', 5)).toBe(0);
  });
  it('ignores a missing or unusable value', () => {
    expect(startIndexFromSearch('', 5)).toBeNull();
    expect(startIndexFromSearch('?level=', 5)).toBeNull();
    expect(startIndexFromSearch('?level=abc', 5)).toBeNull();
    expect(startIndexFromSearch('?level=-2', 5)).toBeNull();
    expect(startIndexFromSearch('?level=2.5', 5)).toBeNull();
  });
});
