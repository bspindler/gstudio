import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DID_YOU_KNOW, FIELD_NOTES, PAL_HOME, POOL_SIZE, STAGES, claimThriving, didYouKnow, homeScenery, initReef,
  pendingThriving, poolInfo, poolLevels, poolOf, poolProgress, reefPools, residents, stageFor, takeStageUps,
  thrivingReward,
} from '../../../games/tidepool-pals/reef.js';
import { fresh, migrate, resetProgress, type Save } from '../../../games/tidepool-pals/save.js';

const PALS = ['pebbin', 'fizz', 'snapjaw', 'marlo', 'bloop', 'tango', 'spindle', 'coralie', 'gloam', 'wisp', 'lumen', 'abyssa'];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** A save that has cleared levels 1..upTo (inclusive) with the given stars. */
const cleared = (upTo: number, stars = 2, over: Partial<Save> = {}): Save => {
  const S = { ...fresh(), level: upTo + 1, ...over };
  S.stars = Object.fromEntries(range(1, upTo).map((n) => [n, stars]));
  return S;
};

describe('tidepool reef: pools', () => {
  it('ten levels per pool: 1-10 is pool 0, 11-20 pool 1, and so on', () => {
    expect(POOL_SIZE).toBe(10);
    expect(poolOf(1)).toBe(0);
    expect(poolOf(10)).toBe(0);
    expect(poolOf(11)).toBe(1);
    expect(poolOf(20)).toBe(1);
    expect(poolOf(21)).toBe(2);
    expect(poolOf(105)).toBe(10);
    expect(poolLevels(1)).toEqual(range(11, 20));
  });

  it('prefers a level\'s own pool tag when a lookup provides one, and falls back to the formula', () => {
    expect(poolOf(5, () => ({ pool: 3 }))).toBe(3);
    expect(poolOf(15, () => ({}))).toBe(1);
    expect(poolOf(15, () => null)).toBe(1);
    expect(poolOf(15, () => ({ pool: -1 }))).toBe(1);
  });

  it('agrees with the formula for every level (guards the levelFor(n).pool tag once it lands)', () => {
    for (const n of range(1, 200)) expect(poolOf(n)).toBe(Math.floor((n - 1) / 10));
  });

  it('has authored names first, then generated names and palettes forever, all distinct', () => {
    expect(poolInfo(0).name).toBe('Driftwood Cove');
    expect(poolInfo(1).name).toBe('Kelp Hollow');
    expect(poolInfo(2).name).toBe('Sunken Arch');
    expect(poolInfo(3).name).toBe('Glowtide Grotto');
    const names = range(0, 59).map((p) => poolInfo(p).name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of range(0, 59)) {
      const i = poolInfo(p);
      expect(i.palette.top).toMatch(/^#[0-9a-f]{6}$/i);
      expect(i.palette.bottom).toMatch(/^#[0-9a-f]{6}$/i);
      expect(i.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(i.scenery.id).toBeTruthy();
      expect(poolInfo(p)).toEqual(i); // deterministic
    }
  });
});

describe('tidepool reef: restoration and stages', () => {
  it('four stages from polluted to thriving, by the share of the pool\'s levels cleared', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['polluted', 'cleaning', 'recovering', 'thriving']);
    expect(stageFor(0)).toBe(0);
    expect(stageFor(0.2)).toBe(0);
    expect(stageFor(0.3)).toBe(1);
    expect(stageFor(0.6)).toBe(1);
    expect(stageFor(0.7)).toBe(2);
    expect(stageFor(0.9)).toBe(2);
    expect(stageFor(1)).toBe(3);
  });

  it('counts cleared levels and stars per pool; stars never change the stage', () => {
    const S = cleared(13, 3);
    const p0 = poolProgress(S, 0), p1 = poolProgress(S, 1);
    expect(p0).toMatchObject({ pool: 0, cleared: 10, total: 10, fraction: 1, stars: 30, maxStars: 30, stage: 3, unlocked: true, current: false });
    expect(p1).toMatchObject({ pool: 1, cleared: 3, fraction: 0.3, stars: 9, stage: 1, unlocked: true, current: true });
    const low = cleared(13, 1);
    expect(poolProgress(low, 1).stage).toBe(p1.stage);
    expect(poolProgress(S, 2)).toMatchObject({ cleared: 0, stage: 0, unlocked: false });
  });

  it('pools never regress: a lower replay score keeps the clear', () => {
    const S = cleared(10, 3);
    S.stars[4] = 3; // a replay can only raise stars (recordWin keeps the best), so the pool stays thriving
    expect(poolProgress(S, 0).stage).toBe(3);
  });

  it('shows every pool reached so far plus one locked pool ahead', () => {
    expect(reefPools(fresh()).map((p) => [p.pool, p.unlocked])).toEqual([[0, true], [1, false]]);
    expect(reefPools(cleared(23)).map((p) => [p.pool, p.unlocked])).toEqual([[0, true], [1, true], [2, true], [3, false]]);
  });

  it('reports each stage-up once, and nothing for a fresh save', () => {
    const S = fresh();
    initReef(S);
    expect(takeStageUps(S)).toEqual([]);
    S.stars = { 1: 2, 2: 2, 3: 1 };
    expect(takeStageUps(S)).toEqual([{ pool: 0, from: 0, to: 1 }]);
    expect(takeStageUps(S)).toEqual([]);
    for (const n of range(4, 10)) S.stars[n] = 1;
    expect(takeStageUps(S)).toEqual([{ pool: 0, from: 1, to: 3 }]);
    expect(takeStageUps(S)).toEqual([]);
  });
});

describe('tidepool reef: thriving rewards (deterministic, granted once)', () => {
  it('rewards are fixed pearls plus that pool\'s scenery unlock', () => {
    for (const p of range(0, 30)) {
      const r = thrivingReward(p);
      expect(r.pearls).toBeGreaterThan(0);
      expect(r.decor).toBe(poolInfo(p).scenery.id);
      expect(thrivingReward(p)).toEqual(r);
      expect(JSON.stringify(r)).not.toMatch(/shell|random|odds/i);
    }
  });

  it('grants a thriving pool\'s reward exactly once, and never before it is thriving', () => {
    const S = cleared(9);
    initReef(S);
    const before = S.pearls;
    expect(claimThriving(S, 0)).toBeNull();
    expect(S.pearls).toBe(before);
    S.stars[10] = 1;
    expect(pendingThriving(S)).toEqual([0]);
    const r = claimThriving(S, 0);
    expect(r).toEqual(thrivingReward(0));
    expect(S.pearls).toBe(before + r!.pearls);
    expect(S.reef.claimed[0]).toBe(true);
    expect(claimThriving(S, 0)).toBeNull();
    expect(S.pearls).toBe(before + r!.pearls);
    expect(pendingThriving(S)).toEqual([]);
  });

  it('never touches shells, and the module has no randomness at all', () => {
    const S = cleared(30);
    initReef(S);
    for (const p of pendingThriving(S)) claimThriving(S, p);
    expect(S.shells).toBe(0);
    const src = readFileSync(new URL('../../../games/tidepool-pals/reef.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/Math\.random|odds\.roll|\.shells\b/);
  });

  it('home scenery lists the unlocks of claimed thriving pools, in pool order', () => {
    const S = cleared(25);
    initReef(S);
    expect(homeScenery(S)).toEqual([]);
    for (const p of pendingThriving(S)) claimThriving(S, p);
    expect(homeScenery(S).map((x) => x.pool)).toEqual([0, 1]);
    expect(homeScenery(S).map((x) => x.id)).toEqual([poolInfo(0).scenery.id, poolInfo(1).scenery.id]);
  });
});

describe('tidepool reef: residents', () => {
  it('only thriving pools have residents, and only pals the player owns', () => {
    const S = cleared(5, 2, { album: { pebbin: 1, bloop: 2 } });
    expect(residents(S, PALS)).toEqual({});
    const T = cleared(10, 2, { album: { pebbin: 1, bloop: 2 } });
    const r = residents(T, PALS);
    expect(Object.keys(r)).toEqual(['0']);
    expect(r[0]!.sort()).toEqual(['bloop', 'pebbin']);
  });

  it('a pal lives in its favourite pool once that pool thrives, else the first thriving pool', () => {
    const album = Object.fromEntries(PALS.map((id) => [id, 1]));
    const S = cleared(40, 2, { album });
    const r = residents(S, PALS);
    for (const id of PALS) {
      const home = PAL_HOME[id]!;
      const where = Object.entries(r).find(([, ids]) => ids.includes(id))![0];
      expect(+where).toBe(home <= 3 ? home : 0);
    }
    // each pal lives in exactly one pool
    expect(Object.values(r).flat().sort()).toEqual([...PALS].sort());
  });

  it('is deterministic: same save, same residents, whatever the album order', () => {
    const S = cleared(20, 2, { album: { wisp: 1, pebbin: 1, coralie: 1, snapjaw: 3 } });
    const a = residents(S, PALS);
    const b = residents({ ...S, album: { snapjaw: 3, coralie: 1, pebbin: 1, wisp: 1 } }, PALS);
    expect(b).toEqual(a);
    expect(residents(S, PALS)).toEqual(a);
  });

  it('every pal has a favourite pool', () => {
    for (const id of PALS) expect(Number.isInteger(PAL_HOME[id])).toBe(true);
  });
});

describe('tidepool reef: field notes and did-you-know', () => {
  it('every pal has field notes: a real animal and 2-3 short lines', () => {
    for (const id of PALS) {
      const n = FIELD_NOTES[id]!;
      expect(n.animal.length).toBeGreaterThan(2);
      expect(n.lines.length).toBeGreaterThanOrEqual(2);
      expect(n.lines.length).toBeLessThanOrEqual(3);
      for (const l of n.lines) expect(l.length).toBeLessThan(140);
    }
  });

  it('every stage has at least one fact, picked deterministically per pool', () => {
    expect(DID_YOU_KNOW).toHaveLength(4);
    for (const s of [0, 1, 2, 3]) {
      expect(DID_YOU_KNOW[s]!.length).toBeGreaterThan(0);
      expect(didYouKnow(5, s)).toBe(didYouKnow(5, s));
      expect(DID_YOU_KNOW[s]).toContain(didYouKnow(2, s));
    }
  });

  it('the copy stays warm: no guilt, no urgency', () => {
    const src = readFileSync(new URL('../../../games/tidepool-pals/reef.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/dying|hurry|before it'?s too late|last chance|don'?t let/i);
  });
});

describe('tidepool reef: save fields and migration', () => {
  it('a fresh save has an empty reef with every stage already seen at 0', () => {
    expect(fresh().reef).toEqual({ claimed: {}, seen: {} });
    expect(resetProgress(cleared(30)).reef).toEqual({ claimed: {}, seen: {} });
  });

  it('a v2 save from before the reef keeps everything and maps its progress onto the reef', () => {
    const stars = Object.fromEntries(range(1, 16).map((n) => [n, n % 3 + 1]));
    const S = migrate({ v: 2, level: 17, stars, pearls: 400, album: { pebbin: 1, fizz: 1 } });
    expect(S).toMatchObject({ v: 2, level: 17, pearls: 400, stars });
    expect(S.reef).toEqual({ claimed: {}, seen: null });
    initReef(S);
    expect(poolProgress(S, 0)).toMatchObject({ cleared: 10, stage: 3 });
    expect(poolProgress(S, 1)).toMatchObject({ cleared: 6, stage: 1, current: true });
    // progress made before the reef existed is not replayed as stage-ups...
    expect(takeStageUps(S)).toEqual([]);
    // ...but the thriving pool's reward is still waiting, once
    expect(pendingThriving(S)).toEqual([0]);
    expect(claimThriving(S, 0)).toEqual(thrivingReward(0));
    expect(pendingThriving(S)).toEqual([]);
    expect(residents(S, PALS)).toEqual({ 0: ['pebbin', 'fizz'] });
  });

  it('a v1 save also lands on the reef without replaying old stage-ups', () => {
    const S = migrate({ v: 1, level: 12, pearls: 50, album: {} });
    initReef(S);
    expect(poolProgress(S, 0).stage).toBe(3);
    expect(poolProgress(S, 1).cleared).toBe(1);
    expect(takeStageUps(S)).toEqual([]);
  });

  it('a v2 save that already has a reef keeps its claims and seen stages', () => {
    const S = migrate({ v: 2, level: 11, stars: Object.fromEntries(range(1, 10).map((n) => [n, 1])), reef: { claimed: { 0: true }, seen: { 0: 3 } } });
    expect(S.reef).toEqual({ claimed: { 0: true }, seen: { 0: 3 } });
    initReef(S);
    expect(pendingThriving(S)).toEqual([]);
    expect(migrate({ v: 2, reef: 'junk' }).reef).toEqual({ claimed: {}, seen: null });
  });
});
