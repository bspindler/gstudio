import { describe, expect, it } from 'vitest';

import { BEAT, speedAt, tauAt, xAtTau } from '../../../games/hyperline/lib/world.js';

describe('hyperline course time: the clock the music and the beat sectors share', () => {
  it('BEAT is half a second (120 BPM)', () => expect(BEAT).toBe(0.5));

  it('tauAt(x) is the time a runner takes to reach x (the integral of 1 / speed)', () => {
    // a fine numeric integral agrees with the closed form everywhere, across every piece of the speed curve
    let tau = 0;
    const dx = 0.05;
    for (let x = 0; x < 4000; x += dx) {
      tau += dx / speedAt(x + dx / 2);
      if (Math.abs((x + dx) % 250) < dx / 2) expect(tauAt(x + dx)).toBeCloseTo(tau, 3);
    }
    expect(tauAt(0)).toBe(0);
  });

  it('xAtTau inverts it', () => {
    for (const x of [0, 10, 500, 765, 900, 1500, 2100, 2700, 5000, 8000]) expect(xAtTau(tauAt(x))).toBeCloseTo(x, 6);
  });
});

describe('hyperline beat sectors (quality plan phase 5)', async () => {
  const { createCourse, extendCourse, INTRO } = await import('../../../games/hyperline/lib/course.js');
  const { AIR, SECTORS, SECTOR_LEN } = await import('../../../games/hyperline/lib/world.js');
  const takeoff = (mid: number) => { let xt = mid; for (let i = 0; i < 6; i++) xt = mid - (AIR * speedAt(xt)) / 2; return xt; };

  it('ON THE BEAT and BACKBEAT come just before HYPERCORE', () => {
    const names = SECTORS.map((s: { name: string }) => s.name);
    expect(names.slice(-3)).toEqual(['ON THE BEAT', 'BACKBEAT', 'HYPERCORE']);
    expect(INTRO[names.indexOf('ON THE BEAT')]).toBe('beat');
    expect(INTRO[names.indexOf('BACKBEAT')]).toBe('backbeat');
  });

  it('every beat-pattern spike and pit is placed so its ideal take-off falls on a beat', () => {
    for (const seed of [1, 7, 42]) {
      const s21 = SECTORS.findIndex((s: { name: string }) => s.name === 'ON THE BEAT') * SECTOR_LEN;
      const c = createCourse(seed, s21);
      extendCourse(c, s21 + 2 * SECTOR_LEN);
      const beaty = c.objs.filter((o) => (o.p === 'beat' || o.p === 'backbeat') && (o.t === 'spike' || o.t === 'pit'));
      expect(beaty.length).toBeGreaterThanOrEqual(6);
      for (const o of beaty as unknown as { t: string; x: number; w?: number }[]) {
        const xt = o.t === 'spike' ? takeoff(o.x + 0.4) : (() => { // a pit is centred on its jump
          const mid = o.x + o.w! / 2; return takeoff(mid);
        })();
        const beats = tauAt(xt) / BEAT;
        expect(Math.abs(beats - Math.round(beats)), `${o.t} at ${o.x.toFixed(2)}`).toBeLessThan(0.02);
      }
    }
  });
});

describe('hyperline audio (quality plan phase 4)', async () => {
  const { readFileSync } = await import('node:fs');
  const sfx = (await import('../../../games/hyperline/audio/sfx.js')).default as Record<string, string>;
  const src = readFileSync(new URL('../../../games/hyperline/audio.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
  const sources = readFileSync(new URL('../../../games/hyperline/audio/SOURCES.md', import.meta.url), 'utf8');

  it('every sample the engine plays is embedded (MP3 data, no fetching) and listed in SOURCES.md with its CC0 pack', () => {
    const played = [...new Set([...src.matchAll(/play\('([a-zA-Z]+)'/g), ...src.matchAll(/'(flipIn|flipOut)'/g)].map((m) => m[1]!))];
    expect(played.length).toBeGreaterThanOrEqual(18);
    for (const n of [...played, 'wind']) {
      expect(sfx[n], n).toBeDefined();
      expect(Buffer.from(sfx[n]!, 'base64').subarray(0, 3).toString('latin1'), n).toMatch(/^(ID3|\xff[\xfb\xf3\xf2])/);
      expect(sources, n).toContain(`| \`${n}\` |`);
    }
    expect(sources).toContain('CC0');
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|new Audio\(/);
  });

  it('the music is clocked by course time at the runner, so beats are the track\'s', () => {
    expect(html).toMatch(/audio\.setClock\(\(\) => \(G && G\.state === 'run' \? tauAt\(G\.runner\.x \+ PS \/ 2\) : null\)\)/);
    expect(src).toMatch(/const SIX = BEAT \/ 4/);
    expect(src).toMatch(/while \(\(stepDone \+ 1\) \* SIX < tau \+ 0\.12 \* rate\)/);
  });

  it('a limiter on the master, the wind bed follows speed, and the music ducks on a crash', () => {
    expect(src).toContain('createDynamicsCompressor');
    expect(html).toMatch(/audio\.wind\(speedAt\(G\.runner\.x\), G\.state === 'run' && modal\.hidden\)/);
    expect(src).toMatch(/musicDuck\.gain\.setTargetAtTime\(0\.12/);
  });
});
