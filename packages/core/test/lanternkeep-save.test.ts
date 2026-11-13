import { describe, expect, it } from 'vitest';

import { emptySave, isUnlocked, parseSave, recordStars, totalStars } from '../../../games/lanternkeep/lib/save.js';

describe('lanternkeep: save', () => {
  it('starts empty and survives junk', () => {
    expect(parseSave(null)).toEqual(emptySave());
    expect(parseSave('{not json')).toEqual(emptySave());
    expect(parseSave('{"v":9,"stars":[3]}')).toEqual(emptySave());
  });

  it('clamps stars and settings it reads back', () => {
    const s = parseSave(JSON.stringify({ v: 1, stars: [3, 9, -2, 'x'], sound: false, speed: 7 }));
    expect(s).toEqual({ v: 1, stars: [3, 3, 0, 0], sound: false, speed: 1 });
  });

  it('keeps the best stars and unlocks the next level on any win', () => {
    let s = recordStars(emptySave(), 0, 2);
    s = recordStars(s, 0, 1);
    expect(s.stars).toEqual([2]);
    expect(isUnlocked(s, 0)).toBe(true);
    expect(isUnlocked(s, 1)).toBe(true);
    expect(isUnlocked(s, 2)).toBe(false);
    s = recordStars(s, 2, 3);
    expect(s.stars).toEqual([2, 0, 3]);
    expect(totalStars(s)).toBe(5);
  });
});
