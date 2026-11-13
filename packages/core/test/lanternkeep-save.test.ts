import { describe, expect, it } from 'vitest';

import { PERKS, canTake, modsFor, sparksFree } from '../../../games/lanternkeep/lib/meta.js';
import { emptySave, isUnlocked, markSeen, parseSave, recordStars, totalStars } from '../../../games/lanternkeep/lib/save.js';

describe('lanternkeep: save', () => {
  it('starts empty and survives junk', () => {
    expect(parseSave(null)).toEqual(emptySave());
    expect(parseSave('{not json')).toEqual(emptySave());
    expect(parseSave('{"v":9,"stars":[3]}')).toEqual(emptySave());
  });

  it('clamps what it reads back', () => {
    const s = parseSave(JSON.stringify({ v: 2, stars: [3, 9, -2, 'x'], perks: ['wick', 4], sound: false, speed: 7, endlessBest: -3 }));
    expect(s.stars).toEqual([3, 3, 0, 0]);
    expect(s.perks).toEqual(['wick']);
    expect(s.sound).toBe(false);
    expect(s.speed).toBe(1);
    expect(s.endlessBest).toBe(0);
  });

  it('migrates a v1 save', () => {
    const s = parseSave(null, JSON.stringify({ v: 1, stars: [3, 2], sound: false, speed: 2 }));
    expect(s).toEqual({ ...emptySave(), stars: [3, 2], sound: false, speed: 2 });
  });

  it('keeps the best stars and unlocks the next level on any win', () => {
    let s = recordStars(emptySave(), 0, 2);
    s = recordStars(s, 0, 1);
    expect(s.stars).toEqual([2]);
    expect(isUnlocked(s, 1)).toBe(true);
    expect(isUnlocked(s, 2)).toBe(false);
    s = recordStars(s, 2, 3);
    expect(totalStars(s)).toBe(5);
  });

  it('remembers reveal cards once', () => {
    const s = markSeen(markSeen(emptySave(), 'moth'), 'moth');
    expect(s.seen).toEqual(['moth']);
  });
});

describe('lanternkeep: perks', () => {
  it('cost sparks, one per star, and combine into game mods', () => {
    expect(sparksFree(6, [])).toBe(6);
    expect(canTake(2, [], 'wick')).toBe(false);
    expect(canTake(3, [], 'wick')).toBe(true);
    expect(canTake(10, ['wick'], 'wick')).toBe(false);
    expect(sparksFree(10, ['wick', 'purse'])).toBe(4);
    expect(modsFor(['wick', 'kindle'])).toEqual({ lives: 3, flareCooldown: 0.7 });
  });

  it('can all be owned by a player who masters the campaign', () => {
    expect(PERKS.reduce((s, p) => s + p.cost, 0)).toBeLessThanOrEqual(15 * 3);
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
  });
});
