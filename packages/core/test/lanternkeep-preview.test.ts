import { describe, expect, it } from 'vitest';

import { drawSilhouette, previewKinds } from '../../../games/lanternkeep/preview.js';

const level = { waves: [[['moth', 3, 1], ['beetle', 2, 1], ['moth', 2, 1]], [['stag', 1, 1]]] };

describe('lanternkeep wave preview', () => {
  it('lists each kind of the next wave once, in order of appearance', () => {
    expect(previewKinds({ level, phase: 'ready', queue: [], waveIndex: -1 } as never)).toEqual(['moth', 'beetle']);
    expect(previewKinds({ level, phase: 'wave', queue: [], waveIndex: 0 } as never)).toEqual(['stag']);
  });

  it('is empty while a wave is still arriving, on the last wave, and after the game', () => {
    expect(previewKinds({ level, phase: 'wave', queue: [{}], waveIndex: 0 } as never)).toEqual([]);
    expect(previewKinds({ level, phase: 'wave', queue: [], waveIndex: 1 } as never)).toEqual([]);
    expect(previewKinds({ level, phase: 'won', queue: [], waveIndex: 0 } as never)).toEqual([]);
    expect(previewKinds(null)).toEqual([]);
  });

  it('draws every creature kind without throwing', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'save' || k === 'restore' ? () => calls.push(String(k)) : () => {}), set: () => true });
    for (const k of ['moth', 'lampmoth', 'mothmother', 'firefly', 'beetle', 'mossback', 'wisp', 'twinwisp', 'shadebearer', 'mole', 'burrower', 'toad', 'stag', 'unknown']) {
      drawSilhouette(ctx as never, k, 60);
    }
    expect(calls.length).toBe(28);
  });
});
