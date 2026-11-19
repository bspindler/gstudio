import { expect, it } from 'vitest';
// @ts-ignore
import { levelDef } from '../../../games/tidepool-pals/levels.js';
it('level 28 keeps its rescue + litter goals, moves and open space under the goal', () => {
  const d = levelDef(28);
  expect(d.goals.map((g: { t: string }) => g.t)).toEqual(['rescue', 'litter']);
  expect(d.moves).toBe(33);
  expect(d.layout[6]).toBe('.......');
});
