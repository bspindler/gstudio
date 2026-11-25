import { expect, it } from 'vitest';
import { playLevel } from '../src/hal/tidepool-bot.js';
import { levelDef } from '../../../games/tidepool-pals/levels.js';

// Level 33 (seahorse pool) must land in the 45-85% band that Hal's scorer wants for levels 16 and later.
it('level 33: the Hal robot wins between 45% and 85% of 100 seeds', () => {
  let wins = 0;
  for (let s = 1; s <= 100; s++) if (playLevel(levelDef(33) as never, s).won) wins++;
  expect(wins).toBeGreaterThanOrEqual(45);
  expect(wins).toBeLessThanOrEqual(85);
}, 120000);
