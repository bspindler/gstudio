import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS module without types
import { attackGlint, GLINT_WINDOW } from '../../../games/gearhold/glint.js';

const base = { awake: true, dead: false, kind: 'g', cd: 0.1 };

describe('gearhold attack glint', () => {
  it('shows only just before an attack that would fire', () => {
    expect(attackGlint(base, 8, true)).toBeGreaterThan(0);
    expect(attackGlint({ ...base, cd: GLINT_WINDOW + 0.2 }, 8, true)).toBe(0);
    expect(attackGlint({ ...base, cd: 0 }, 8, true)).toBe(0);
  });
  it('needs range and sight', () => {
    expect(attackGlint(base, 8, false)).toBe(0);
    expect(attackGlint({ ...base, kind: 'c' }, 5, true)).toBe(0);
    expect(attackGlint({ ...base, kind: 'c' }, 1, true)).toBeGreaterThan(0);
  });
  it('leaves asleep, dead, rams and turrets alone', () => {
    expect(attackGlint({ ...base, awake: false }, 1, true)).toBe(0);
    expect(attackGlint({ ...base, dead: true }, 1, true)).toBe(0);
    expect(attackGlint({ ...base, kind: 'r' }, 1, true)).toBe(0);
    expect(attackGlint({ ...base, kind: 't' }, 1, true)).toBe(0);
  });
});
