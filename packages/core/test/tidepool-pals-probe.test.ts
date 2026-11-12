import { expect, it } from 'vitest';
import { levelDef } from '../../../games/tidepool-pals/levels.js';
import { playLevel } from '../src/hal/tidepool-bot.js';

// The robot's win rate over the scorer's 20 seeds: going into an eased level, it must not drop by more than 30 points.
const winRate = (n: number): number => {
  const def = levelDef(n);
  return Array.from({ length: 20 }, (_, i) => playLevel(def, i + 1)).filter((p) => p.won).length / 20;
};

it('levels 14 and 28 are no longer walls after the level before them', () => {
  for (const n of [14, 28]) expect(winRate(n - 1) - winRate(n)).toBeLessThanOrEqual(0.3);
});
