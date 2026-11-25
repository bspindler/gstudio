import { describe, expect, it } from 'vitest';

import { createGhostRecorder, ghostAt, recordGhost, finishGhost, GHOST_HZ, GHOST_MAX } from '../../../games/hyperline/lib/ghost.js';
import {
  applyEvent, checkMissions, chipMultiplier, freshSave, migrateSave, MISSIONS, missionProgress, NEAR_CR, newRunStats,
  rollMission, runCredits,
} from '../../../games/hyperline/lib/meta.js';

describe('hyperline scoring: near misses and chip streaks', () => {
  it('the chip multiplier grows every 8 chips in a row and caps at x4', () => {
    expect([0, 1, 7, 8, 15, 16, 24, 80].map(chipMultiplier)).toEqual([1, 1, 1, 2, 2, 3, 4, 4]);
  });

  it('chips build a streak worth more; a missed chip resets it', () => {
    let s = newRunStats('endless');
    for (let i = 0; i < 9; i++) s = applyEvent(s, { t: 'chip' });
    expect(s.chips).toBe(9);
    expect(s.streak).toBe(9);
    expect(s.chipPts).toBe(7 * 3 + 2 * 6); // chips 8 and 9 are at x2
    s = applyEvent(s, { t: 'chipMiss' });
    expect(s.streak).toBe(0);
    expect(s.maxStreak).toBe(9);
    s = applyEvent(s, { t: 'chip' });
    expect(s.chipPts).toBe(7 * 3 + 2 * 6 + 3);
  });

  it('near misses pay bonus credits', () => {
    let s = newRunStats('endless');
    s = applyEvent(s, { t: 'near', margin: 0.1 });
    s = applyEvent(s, { t: 'near', margin: 0.2 });
    s.dist = 100;
    expect(s.near).toBe(2);
    expect(runCredits(s)).toBe(20 + 2 * NEAR_CR);
  });

  it('tracks the most spikes cleared in one jump, pads, bars, flips and sectors', () => {
    let s = newRunStats('daily');
    s = applyEvent(s, { t: 'land', spikes: 2 });
    s = applyEvent(s, { t: 'land', spikes: 3 });
    s = applyEvent(s, { t: 'land', spikes: 1 });
    s = applyEvent(s, { t: 'pad' });
    s = applyEvent(s, { t: 'bar' });
    s = applyEvent(s, { t: 'flipOut' });
    s = applyEvent(s, { t: 'sector', sector: 2 });
    expect([s.maxAirSpikes, s.pads, s.bars, s.flips, s.sector]).toEqual([3, 1, 1, 1, 2]);
  });

  it('cleanSector only counts sectors reached before the first chip', () => {
    let s = newRunStats('endless');
    s = applyEvent(s, { t: 'sector', sector: 2 });
    expect(s.cleanSector).toBe(2);
    s = applyEvent(s, { t: 'chip' });
    s = applyEvent(s, { t: 'sector', sector: 3 });
    expect(s.cleanSector).toBe(2);
    expect(s.sector).toBe(3);
  });

  it('does not mutate the stats it is given', () => {
    const s = newRunStats('endless');
    applyEvent(s, { t: 'chip' });
    expect(s.chips).toBe(0);
  });
});

describe('hyperline missions', () => {
  it('has unique ids, positive targets and credit rewards', () => {
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
    for (const m of MISSIONS) { expect(m.target).toBeGreaterThan(0); expect(m.reward).toBeGreaterThan(0); expect(m.text.length).toBeGreaterThan(5); }
  });

  it('includes the three headline missions', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['air3', 'clean3', 'chips40']));
  });

  it('evaluates progress from run stats', () => {
    const air3 = MISSIONS.find((m) => m.id === 'air3')!;
    const clean3 = MISSIONS.find((m) => m.id === 'clean3')!;
    let s = newRunStats('endless');
    expect(missionProgress(air3, s)).toBe(0);
    s = applyEvent(s, { t: 'land', spikes: 3 });
    expect(missionProgress(air3, s)).toBe(3);
    s = applyEvent(s, { t: 'sector', sector: 3 });
    expect(missionProgress(clean3, s)).toBe(3);
  });

  it('daily-only missions make no progress in endless', () => {
    const daily = MISSIONS.find((m) => m.mode === 'daily')!;
    const s = { ...newRunStats('endless'), dist: 5000 };
    expect(missionProgress(daily, s)).toBe(0);
    expect(missionProgress(daily, { ...s, mode: 'daily' })).toBe(daily.target);
  });

  it('checkMissions returns the active missions a run completed', () => {
    let s = newRunStats('endless');
    for (let i = 0; i < 40; i++) s = applyEvent(s, { t: 'chip' });
    expect(checkMissions(['chips40', 'air3', 'clean3'], s)).toEqual(['chips40']);
    expect(checkMissions(['air3', 'clean3'], s)).toEqual([]);
  });

  it('rollMission is deterministic and never duplicates an active mission', () => {
    const a = rollMission(3, ['chips25', 'dist300', 'near3']);
    expect(a).toEqual(rollMission(3, ['chips25', 'dist300', 'near3']));
    for (let seq = 0; seq < 60; seq++) {
      const active = ['air3', 'clean3', 'chips40'];
      const m = rollMission(seq, active);
      expect(active).not.toContain(m.id);
      expect(m.seq).toBeGreaterThan(seq);
    }
  });
});

describe('hyperline save migration', () => {
  it('migrates a v2 save to v3 without losing progress', () => {
    const v2 = { v: 2, credits: 987, owned: { volt: 1, vapor: 2, serpent: 1 }, eq: 'vapor', best: 812, runs: 41, crates: 1, opened: 7,
      top: [{ run: 30, d: 812, at: 1 }] };
    const s = migrateSave(v2);
    expect(s.v).toBe(3);
    expect(s.credits).toBe(987);
    expect(s.owned).toEqual({ volt: 1, vapor: 2, serpent: 1 });
    expect(s.eq).toBe('vapor');
    expect([s.best, s.runs, s.crates, s.opened]).toEqual([812, 41, 1, 7]);
    expect(s.top).toEqual([{ run: 30, d: 812, at: 1 }]);
    expect(s.trail).toBe('classic');
    expect(s.trails).toEqual({ classic: 1 });
    expect(s.missions).toHaveLength(3);
    expect(s.settings).toEqual({ sound: true, music: true, haptics: true, ghost: false, bigRunner: false });
    expect(s.daily).toEqual({ day: '', best: 0 });
  });

  it('migrates a v1 save through v2', () => {
    const s = migrateSave({ v: 1, credits: 40, owned: { volt: 1, mint: 1 }, eq: 'mint', best: 120, runs: 5 });
    expect([s.v, s.credits, s.eq, s.best, s.runs]).toEqual([3, 40, 'mint', 120, 5]);
    expect(s.top[0]!.d).toBe(120);
  });

  it('repairs a v3 save with missing or bad fields instead of wiping it', () => {
    const s = migrateSave({ v: 3, credits: 10, owned: { volt: 1 }, eq: 'nope', best: 5, missions: ['air3', 'bogus'] });
    expect(s.credits).toBe(10);
    expect(s.eq).toBe('volt');
    expect(s.missions).toHaveLength(3);
    expect(s.missions).toContain('air3');
    expect(s.missions).not.toContain('bogus');
  });

  it('anything unreadable starts fresh', () => {
    expect(migrateSave(null)).toEqual(freshSave());
    expect(migrateSave('junk')).toEqual(freshSave());
    expect(migrateSave({ v: 99 })).toEqual(freshSave());
  });

  it('a fresh save has three missions and the starter skin', () => {
    const f = freshSave();
    expect(f.owned).toEqual({ volt: 1 });
    expect(new Set(f.missions).size).toBe(3);
  });
});

describe('hyperline ghost', () => {
  it('records samples at a fixed rate and replays with interpolation', () => {
    const g = createGhostRecorder();
    for (let i = 0; i <= 120; i++) recordGhost(g, i / 120, 1.6 + i * 0.1, i < 60 ? 0 : 2, false);
    const done = finishGhost(g);
    expect(done.n).toBe(GHOST_HZ + 1);
    const a = ghostAt(done, 0.5)!;
    expect(a.x).toBeCloseTo(1.6 + 6, 1);
    const mid = ghostAt(done, 0.025)!;
    expect(mid.x).toBeGreaterThan(ghostAt(done, 0)!.x);
    expect(ghostAt(done, 1.0)).not.toBeNull();
    expect(ghostAt(done, 5)).toBeNull();
  });

  it('keeps the flip flag and survives a JSON round trip', () => {
    const g = createGhostRecorder();
    for (let i = 0; i < 240; i++) recordGhost(g, i / 120, i * 0.1, 2.8, i > 100);
    const done = JSON.parse(JSON.stringify(finishGhost(g)));
    expect(ghostAt(done, 0.2)!.flip).toBe(false);
    expect(ghostAt(done, 1.5)!.flip).toBe(true);
  });

  it('caps the recording length', () => {
    const g = createGhostRecorder();
    for (let i = 0; i < (GHOST_MAX + 50) * 6; i++) recordGhost(g, i / 120, i, 0, false);
    expect(finishGhost(g).n).toBe(GHOST_MAX);
  });
});
