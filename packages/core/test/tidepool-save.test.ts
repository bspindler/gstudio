import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EVENT_NAMES } from '../src/index.js';

import {
  BOOSTERS, DECOR, KEY, KEY_V1, STARTER_PAL, addPal, bankShell, buyBoosters, buyDecor, buyPalWithSandDollars, fresh,
  loadSave, migrate, palEarned, pickHelper, recordWin, resetProgress, sandDollarCost, shellDrop, takeShell, type LevelRun,
} from '../../../games/tidepool-pals/save.js';

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const run = (over: Partial<LevelRun> = {}): LevelRun => ({ n: 4, assisted: false, shellDrop: true, shellTaken: false, ...over });
const V1 = { v: 1, level: 7, pearls: 345, shells: 2, album: { pebbin: 3, fizz: 1, marlo: 2 }, claimed: { 0: true }, starter: true };

describe('tidepool save: v1 to v2 migration', () => {
  it('keeps album, pearls, level, shells, claimed sets and the starter flag', () => {
    const s = migrate(V1);
    expect(s).toMatchObject({ v: 2, level: 7, pearls: 345, shells: 2, album: V1.album, claimed: { 0: true }, starter: true });
  });

  it('marks levels the player already passed as cleared (1 star) so the map can replay them', () => {
    const s = migrate(V1);
    expect(s.stars).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 });
  });

  it('grants a sand dollar for every duplicate the player already owns', () => {
    expect(migrate(V1).sandDollars).toBe(3); // pebbin x3 (2 dups) + marlo x2 (1 dup)
  });

  it('returns a fresh save for garbage and passes v2 through, filling missing fields', () => {
    expect(migrate(null)).toEqual(fresh());
    expect(migrate({ v: 9 })).toEqual(fresh());
    expect(migrate('nope')).toEqual(fresh());
    const partial = migrate({ v: 2, level: 3, pearls: 10 });
    expect(partial).toMatchObject({ v: 2, level: 3, pearls: 10, shells: 0, sandDollars: 0, decor: {} });
    expect(partial.settings).toEqual({ sound: true, haptics: true });
  });

  it('loadSave prefers v2, otherwise migrates v1 forward without deleting it', () => {
    const st = memory({ [KEY_V1]: JSON.stringify(V1) });
    const s = loadSave(st);
    expect(s.level).toBe(7);
    expect(JSON.parse(st.m.get(KEY)!)).toMatchObject({ v: 2, level: 7 });
    expect(st.m.has(KEY_V1)).toBe(true);
    st.m.set(KEY, JSON.stringify({ ...fresh(), level: 12 }));
    expect(loadSave(st).level).toBe(12);
    expect(loadSave(memory()).level).toBe(1);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSave(broken)).toEqual(fresh());
  });
});

describe('tidepool save: no paid path to a random reward', () => {
  it('every pre-level booster marks the run assisted, and an assisted run never drops a shell', () => {
    for (const b of BOOSTERS) {
      const S = { ...fresh(), pearls: 10_000 };
      const lvl = run();
      expect(buyBoosters(S, lvl, [b.id])).toBe(true);
      expect(lvl.assisted).toBe(true);
      expect(shellDrop(lvl, 0, 3)).toBe(false);
      lvl.shellDrop = true; // even if something wrongly set it, banking refuses
      expect(bankShell(S, lvl)).toBe(false);
      expect(S.shells).toBe(0);
    }
  });

  it('boosters cost pearls, never shells, and do nothing when the player cannot afford them', () => {
    const S = { ...fresh(), pearls: 0 };
    const lvl = run();
    expect(buyBoosters(S, lvl, [BOOSTERS[0]!.id])).toBe(false);
    expect(lvl.assisted).toBe(false);
    expect(S.pearls).toBe(0);
    for (const b of BOOSTERS) { expect(b.pearls).toBeGreaterThan(0); expect(JSON.stringify(b)).not.toMatch(/shell/i); }
    expect(buyBoosters(S, lvl, [])).toBe(true);
    expect(lvl.assisted).toBe(false);
  });

  it('shells drop on an unassisted first clear or a star improvement, and bank once', () => {
    expect(shellDrop(run(), 0, 1)).toBe(true);
    expect(shellDrop(run(), 2, 2)).toBe(false);
    expect(shellDrop(run(), 2, 3)).toBe(true);
    const S = fresh();
    const lvl = run();
    expect(bankShell(S, lvl)).toBe(true);
    expect(bankShell(S, lvl)).toBe(false);
    expect(S.shells).toBe(1);
    expect(takeShell(S)).toBe(true);
    expect(takeShell(S)).toBe(false);
    expect(bankShell(S, run({ shellDrop: false }))).toBe(false);
  });

  it('the game only adds shells through bankShell (static check on index.html)', () => {
    const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/shells\s*(\+\+|\+=|=[^=])/);
    expect(html).toMatch(/case 'bank-shell':\s*if\s*\(lvl\.assisted\)\s*break;/);
    expect(html).toMatch(/function addMoves\([^]*?lvl\.assisted = true/);
  });

  it('the game only tracks event names the ingest accepts (game events ride on custom)', () => {
    const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
    const names = [...html.matchAll(/\.track\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(3);
    for (const n of names) expect(EVENT_NAMES).toContain(n);
    expect(html).toContain("studio.track('custom'");
  });

  it('decorations are deterministic pearl purchases with nothing random inside', () => {
    const S = { ...fresh(), pearls: 1000 };
    const d = DECOR[0]!;
    expect(buyDecor(S, d.id)).toBe(true);
    expect(S.decor[d.id]).toBe(true);
    expect(S.pearls).toBe(1000 - d.pearls);
    expect(buyDecor(S, d.id)).toBe(false); // already owned
    expect(buyDecor({ ...fresh(), pearls: 0 }, d.id)).toBe(false);
    for (const x of DECOR) expect(Object.keys(x).sort()).toEqual(['id', 'name', 'pearls']);
  });
});

describe('tidepool save: helpers count as earned only when the pal came from play', () => {
  it('a pal whose only copy was bought (the Starter Pack) makes the level assisted when used as a helper', () => {
    const S = fresh();
    addPal(S, STARTER_PAL, 'bought');
    expect(palEarned(S, STARTER_PAL)).toBe(false);
    const lvl = run();
    expect(pickHelper(S, lvl, STARTER_PAL)).toBe(true);
    expect(lvl).toMatchObject({ helper: STARTER_PAL, helperEarned: false, assisted: true, shellDrop: false });
    expect(shellDrop(lvl, 0, 3)).toBe(false);
    lvl.shellDrop = true; // even if something wrongly set it, banking refuses
    expect(bankShell(S, lvl)).toBe(false);
    expect(S.shells).toBe(0);
  });

  it('an earned pal (shell or sand dollars) helps without assisting; owning an earned copy is enough', () => {
    const S = fresh();
    addPal(S, 'fizz');
    const a = run();
    expect(pickHelper(S, a, 'fizz')).toBe(true);
    expect(a).toMatchObject({ assisted: false, helperEarned: true });
    addPal(S, STARTER_PAL, 'bought');
    addPal(S, STARTER_PAL); // later found in a shell
    const b = run();
    pickHelper(S, b, STARTER_PAL);
    expect(b.assisted).toBe(false);
    expect(S.sources[STARTER_PAL]).toEqual({ earned: 1, bought: 1 });
  });

  it('sand-dollar trades record the pal as earned', () => {
    const S = { ...fresh(), sandDollars: 99 };
    buyPalWithSandDollars(S, { id: 'marlo', rar: 'epic' });
    expect(palEarned(S, 'marlo')).toBe(true);
  });

  it('cannot bring a pal the player does not own, and no helper is fine', () => {
    const lvl = run();
    expect(pickHelper(fresh(), lvl, 'lumen')).toBe(false);
    expect(pickHelper(fresh(), lvl, null)).toBe(true);
    expect(lvl.assisted).toBe(false);
  });

  it('migration: old album entries count as earned, except a Starter Pack buyer\'s single Snapjaw', () => {
    const bought = migrate({ ...fresh(), sources: undefined, starter: true, album: { snapjaw: 1, fizz: 2 } });
    expect(bought.sources).toEqual({ snapjaw: { earned: 0, bought: 1 }, fizz: { earned: 2, bought: 0 } });
    expect(palEarned(bought, 'snapjaw')).toBe(false);
    const two = migrate({ ...fresh(), sources: undefined, starter: true, album: { snapjaw: 2 } });
    expect(palEarned(two, 'snapjaw')).toBe(true);
    const noPack = migrate({ ...fresh(), sources: undefined, starter: false, album: { snapjaw: 1 } });
    expect(palEarned(noPack, 'snapjaw')).toBe(true);
    const v1 = migrate({ ...V1, album: { snapjaw: 1 } });
    expect(palEarned(v1, 'snapjaw')).toBe(false);
    // sources already in the save are kept as they are
    const kept = migrate({ ...fresh(), album: { snapjaw: 1 }, sources: { snapjaw: { earned: 1, bought: 0 } }, starter: true });
    expect(palEarned(kept, 'snapjaw')).toBe(true);
  });

  it('the page wires the rule: the Starter Pack adds its pal as bought, and the helper goes through pickHelper', () => {
    const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/addPal\(S, [^)]*'bought'\)/);
    expect(html).toMatch(/pickHelper\(S, run, /);
    expect(html).toContain('Boosted: no shell this level');
  });
});

describe('tidepool save: pals, sand dollars and stars', () => {
  it('a duplicate pal grants 25 pearls and a sand dollar', () => {
    const S = fresh();
    expect(addPal(S, 'fizz')).toEqual({ dup: false, n: 1 });
    expect(addPal(S, 'fizz')).toEqual({ dup: true, n: 2 });
    expect(S.pearls).toBe(fresh().pearls + 25);
    expect(S.sandDollars).toBe(1);
  });

  it('sand dollars buy one specific missing pal, priced by rarity', () => {
    const marlo = { id: 'marlo', rar: 'epic' as const };
    const S = { ...fresh(), sandDollars: sandDollarCost('epic') - 1 };
    expect(buyPalWithSandDollars(S, marlo)).toBe(false);
    S.sandDollars += 1;
    expect(buyPalWithSandDollars(S, marlo)).toBe(true);
    expect(S.album.marlo).toBe(1);
    expect(S.sandDollars).toBe(0);
    S.sandDollars = 99;
    expect(buyPalWithSandDollars(S, marlo)).toBe(false); // already owned
    expect(sandDollarCost('common')).toBeLessThan(sandDollarCost('rare'));
    expect(sandDollarCost('rare')).toBeLessThan(sandDollarCost('epic'));
  });

  it('recordWin keeps the best stars, unlocks the next level and pays less for replays', () => {
    const S = fresh();
    const a = recordWin(S, 1, 2);
    expect(a).toMatchObject({ prevBest: 0, firstClear: true });
    expect(S.stars[1]).toBe(2);
    expect(S.level).toBe(2);
    const b = recordWin(S, 1, 1);
    expect(b).toMatchObject({ prevBest: 2, firstClear: false, pearls: 0 });
    expect(S.stars[1]).toBe(2);
    const c = recordWin(S, 1, 3);
    expect(c.pearls).toBeGreaterThan(0);
    expect(c.pearls).toBeLessThan(a.pearls + 1);
    expect(S.stars[1]).toBe(3);
    expect(S.level).toBe(2);
  });

  it('reset wipes progress but keeps settings', () => {
    const S = { ...fresh(), level: 9, pearls: 5, settings: { sound: false, haptics: true } };
    const r = resetProgress(S);
    expect(r).toEqual({ ...fresh(), settings: { sound: false, haptics: true } });
  });
});
