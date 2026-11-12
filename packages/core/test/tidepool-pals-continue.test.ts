import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { continueAt, poolOf } from '../../../games/tidepool-pals/reef.js';
import { fresh, loadSave, recordWin, writeSave } from '../../../games/tidepool-pals/save.js';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

describe('tidepool continue: a returning player picks up at their furthest unlocked pool', () => {
  it('a brand-new player has nothing to continue', () => {
    expect(continueAt(fresh())).toBeNull();
  });

  it('after a win, Continue points at the next level and its pool', () => {
    const S = fresh();
    recordWin(S, 1, 2);
    expect(continueAt(S)).toEqual({ level: 2, pool: poolOf(2) });
  });

  it('survives a reload through the local save', () => {
    const st = memory();
    const S = fresh();
    for (let n = 1; n <= 12; n++) recordWin(S, n, 1);
    writeSave(st, S);
    const back = loadSave(st);
    expect(continueAt(back)).toEqual({ level: 13, pool: poolOf(13) });
  });

  it('replaying an old level does not move Continue back', () => {
    const S = fresh();
    for (let n = 1; n <= 5; n++) recordWin(S, n, 1);
    recordWin(S, 2, 3);
    expect(continueAt(S)?.level).toBe(6);
  });

  it('never points behind a cleared level, even if the stored level lags', () => {
    expect(continueAt({ ...fresh(), level: 1, stars: { 1: 1, 2: 2, 3: 1 } })?.level).toBe(4);
  });

  it('the page boots on the map and offers Continue from continueAt', () => {
    const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/continueAt\(S\)/);
    expect(html).toMatch(/Continue · Level/);
    expect(html).toMatch(/data-act="play-next"/);
    expect(html).toMatch(/\/\* ---------- boot ---------- \*\/[^]*showView\('map'\)/);
  });
});
