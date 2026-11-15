import { describe, expect, it } from 'vitest';
import { bandScore, tensionMeasure, TENSION_BAND, TENSION_MIN_WINS } from '../src/hal/tension.js';
import { GEARHOLD_CLOSE_HP, scoreGearholdPlay, type PlayRecord } from '../src/hal/gearhold-play-score.js';

describe('tension', () => {
  it('bandScore: 100 inside the band, linear to 0 at 0 and 1', () => {
    expect(bandScore(0.3, TENSION_BAND)).toBe(100);
    expect(bandScore(0, TENSION_BAND)).toBe(0);
    expect(bandScore(1, TENSION_BAND)).toBe(0);
    expect(bandScore(TENSION_BAND[0] / 2, TENSION_BAND)).toBeCloseTo(50);
    expect(bandScore(NaN, TENSION_BAND)).toBe(0);
  });
  it('levels with too few wins are left out; none left scores 100 (the win-rate measures cover that)', () => {
    expect(tensionMeasure([{ wins: 20, close: 6 }, { wins: 20, close: 0 }])).toBe(50);
    expect(tensionMeasure([{ wins: TENSION_MIN_WINS - 1, close: 0 }])).toBe(100);
  });
  it('Gearhold: only wins at low health are close; comfortable wins give 0 tension without touching fitness', () => {
    const rec = (level: number, seed: number, hpLeft: number): PlayRecord => ({ level, seed, result: 'win', time: 60, hpLeft, kills: 3, foes: 3, shotsFired: 10, hits: 5, damageTaken: 10, damageUnseen: 0, cause: '' });
    const comfy = scoreGearholdPlay(Array.from({ length: 10 }, (_, s) => rec(0, s, 90)));
    const tense = scoreGearholdPlay(Array.from({ length: 10 }, (_, s) => rec(0, s, s < 3 ? GEARHOLD_CLOSE_HP : 90)));
    expect(comfy.measures.tension).toBe(0);
    expect(tense.measures.tension).toBe(100);
    expect(tense.levels[0]).toMatchObject({ wins: 10, closeWins: 3 });
    expect(tense.fitness).toBe(comfy.fitness);
  });
});

describe('tension skips the opening (D1, 2026-11-15)', () => {
  it('levels numbered <= skipUpTo do not count', () => {
    const levels = [{ n: 1, wins: 20, close: 0 }, { n: 2, wins: 20, close: 0 }, { n: 6, wins: 20, close: 6 }];
    expect(tensionMeasure(levels)).toBeCloseTo(100 / 3, 1);
    expect(tensionMeasure(levels, { skipUpTo: 5 })).toBe(100);
  });
});
