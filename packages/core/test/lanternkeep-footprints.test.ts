import { describe, expect, it } from 'vitest';

import { CAP, STRIDE, createFootprints } from '../../../games/lanternkeep/footprints.js';

describe('lanternkeep footprints', () => {
  it('leaves a print every stride for walkers, alternating sides', () => {
    const f = createFootprints();
    const e = { id: 2, type: 'beetle' };
    for (let i = 0; i <= 20; i++) f.step(e, 0, i * 0.1, i * 0.05);
    expect(Math.abs(f.prints.length - 2 / STRIDE)).toBeLessThanOrEqual(1);
    expect(f.prints[0]!.x).not.toBeCloseTo(f.prints[1]!.x, 3);
  });

  it('leaves none for flyers or a diving mole', () => {
    const f = createFootprints();
    for (let i = 0; i <= 20; i++) {
      f.step({ id: 1, type: 'moth' }, 0, i * 0.1, 0);
      f.step({ id: 3, type: 'mole', under: true } as never, 0, i * 0.1, 0);
    }
    expect(f.prints.length).toBe(0);
  });

  it('fades out and is pruned after its life', () => {
    const f = createFootprints({ life: 1.5 });
    for (let i = 0; i <= 10; i++) f.step({ id: 2, type: 'toad' }, 0, i * 0.2, 0);
    const p = f.prints[0]!;
    expect(f.fade(p, 0)).toBe(1);
    expect(f.fade(p, 0.75)).toBeLessThan(0.3);
    f.prune(0.5);
    expect(f.prints.length).toBeGreaterThan(0);
    f.prune(1.6);
    expect(f.prints.length).toBe(0);
  });

  it('caps the count with many creatures', () => {
    const f = createFootprints();
    for (let id = 1; id <= 60; id++) for (let i = 0; i <= 40; i++) f.step({ id, type: 'beetle' }, id, i * 0.1, 0);
    expect(f.prints.length).toBeLessThanOrEqual(CAP);
  });
});
