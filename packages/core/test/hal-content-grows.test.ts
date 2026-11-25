// Permission split A (2026-11-15): content grows without a protected edit. Each game's content grows in memory here
// (one more Gearhold level, Hyperline sector, Tidepool level and Lanternkeep night, each a copy of the last; one more
// Block Barn tap-zone kind and feature), and the scorers and the content assumptions of Hal's protected tests must
// still hold. A future test or scorer that pins today's count fails here at once, not on the night Hal adds a level
// (HAL-011, 018, 031, 035 were blocked that way). Kept small: a couple of seeds each.
import { describe, expect, it, vi } from 'vitest';

import { LEVELS as GEAR } from '../../../games/gearhold/levels.js';
import { SECTORS, SECTOR_LEN, sectorAt } from '../../../games/hyperline/lib/world.js';
import { LEVELS as NIGHTS } from '../../../games/lanternkeep/lib/levels.js';
import { AUTHORED, LAST_HAND_LEVEL, levelDef } from '../../../games/tidepool-pals/levels.js';
import { scoreBlockBarn, type BlockBarnGesture, type BlockBarnRecord, type BlockBarnTargetSize, type BlockBarnViewport } from '../src/hal/block-barn-score.js';
import { scoreGearholdPlay, type PlayRecord } from '../src/hal/gearhold-play-score.js';
import { scoreGearhold } from '../src/hal/gearhold-score.js';
import { scoreHyperline } from '../src/hal/hyperline-score.js';
import { scoreLanternkeep, watchPerks, nightPerks } from '../src/hal/lanternkeep-score.js';
import { gearholdPlayScorer, HYPERLINE_UNTIL, SCORERS, TIDEPOOL_TO } from '../src/hal/scorers.js';
import { scoreTidepool } from '../src/hal/tidepool-score.js';

const real = vi.hoisted(() => ({ gear: 0, sectors: 0, authored: 0, nights: 0 }));

vi.mock('../../../games/gearhold/levels.js', async (orig) => {
  const m = await orig<typeof import('../../../games/gearhold/levels.js')>();
  real.gear = m.LEVELS.length;
  const last = m.LEVELS.at(-1)!;
  return { ...m, LEVELS: [...m.LEVELS, { ...structuredClone(last), name: `${last.name} Again` }] };
});
vi.mock('../../../games/hyperline/lib/world.js', async (orig) => {
  const m = await orig<typeof import('../../../games/hyperline/lib/world.js')>();
  real.sectors = m.SECTORS.length;
  const last = m.SECTORS.at(-1)!;
  return { ...m, SECTORS: [...m.SECTORS, { ...structuredClone(last), name: `${last.name} II` }] };
});
vi.mock('../../../games/tidepool-pals/levels.js', async (orig) => {
  const m = await orig<typeof import('../../../games/tidepool-pals/levels.js')>();
  real.authored = m.AUTHORED.length;
  const n = m.AUTHORED.length + 1;
  const added = { ...structuredClone(m.AUTHORED.at(-1)!), n, pool: m.poolOf(n) };
  return { ...m, AUTHORED: [...m.AUTHORED, added], levelDef: (k: number) => (k === n ? structuredClone(added) : m.levelDef(k)), levelFor: (k: number) => (k === n ? structuredClone(added) : m.levelFor(k)) };
});
vi.mock('../../../games/lanternkeep/lib/levels.js', async (orig) => {
  const m = await orig<typeof import('../../../games/lanternkeep/lib/levels.js')>();
  real.nights = m.LEVELS.length;
  const last = m.LEVELS.at(-1)!;
  return { ...m, LEVELS: [...m.LEVELS, { ...structuredClone(last), name: `${last.name} Again` }] };
});

describe('content grows: the game modules really grew', () => {
  it('one more of each', () => {
    expect(GEAR.length).toBe(real.gear + 1);
    expect(SECTORS.length).toBe(real.sectors + 1);
    expect(AUTHORED.length).toBe(real.authored + 1);
    expect(levelDef(AUTHORED.length).n).toBe(AUTHORED.length);
    expect(NIGHTS.length).toBe(real.nights + 1);
  });
});

describe('content grows: Gearhold, one more level', () => {
  it('the static scorer reports every level, the new one too, with no hard failure', () => {
    const r = scoreGearhold();
    expect(r.levels).toHaveLength(GEAR.length);
    expect(r.levels.at(-1)!.name).toBe(GEAR.at(-1)!.name);
    expect(r.hardFailures).toEqual([]);
  });

  it('the play scorer plays every level by default and validates against the real count', () => {
    const s = gearholdPlayScorer(async () => ({ records: [], errors: [] }));
    expect(s.defaults.levels).toBe(GEAR.length);
    expect(s.validate({ ...s.defaults })).toBeNull();
    expect(s.validate({ ...s.defaults, levels: GEAR.length + 1 })).toBe(`--levels must be at most ${GEAR.length} (Gearhold has ${GEAR.length} levels)`);
  });

  it('play records for every level score against the game\'s own maps, the new one too', () => {
    const rec = (level: number, seed: number): PlayRecord => ({
      level, seed, result: seed % 3 ? 'win' : 'dead', time: 60, hpLeft: 40, kills: 4, foes: 4, shotsFired: 40, hits: 20, damageTaken: 30, damageUnseen: 0, cause: seed % 3 ? '' : 'shot',
    });
    const r = scoreGearholdPlay(GEAR.flatMap((_, l) => Array.from({ length: 6 }, (_, s) => rec(l, s))));
    expect(r.levels).toHaveLength(GEAR.length);
    expect(r.hardFailures).toEqual([]);
    expect(r.levels.at(-1)!.routeTiles).toBe(r.levels.at(-2)!.routeTiles); // a copy of the last level walks the same
  });
});

describe('content grows: Hyperline, one more sector', () => {
  it('the default run reaches into the new last sector', () => {
    expect(HYPERLINE_UNTIL).toBe((SECTORS.length - 1) * SECTOR_LEN + 150);
    expect(sectorAt(HYPERLINE_UNTIL - 1)).toBe(SECTORS.length - 1);
    expect(SCORERS.hyperline!.defaults.until).toBe(HYPERLINE_UNTIL);
  });

  it('the scorer plays every sector, the new one too, with no hard failure', () => {
    const r = scoreHyperline({ seeds: 2, until: HYPERLINE_UNTIL });
    expect(r.levels.map((l) => l.sector)).toEqual(SECTORS.map((_, i) => i));
    expect(r.hardFailures).toEqual([]);
    for (const v of Object.values(r.measures)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  }, 60_000);
});

describe('content grows: Tidepool Pals, one more hand-made level', () => {
  it('the default range covers every hand-made level and ten generated ones', () => {
    expect(TIDEPOOL_TO).toBe(Math.max(30, AUTHORED.length + 10, LAST_HAND_LEVEL));
    expect(SCORERS['tidepool-pals']!.defaults.to).toBe(TIDEPOOL_TO);
  });

  it('the scorer plays the new level with no hard failure', () => {
    const n = AUTHORED.length;
    const r = scoreTidepool({ from: n - 1, to: n, seeds: 4 });
    expect(r.levels.map((l) => l.n)).toEqual([n - 1, n]);
    expect(r.hardFailures).toEqual([]);
  }, 60_000);
});

describe('content grows: Lanternkeep, one more night', () => {
  it('perks follow the real night count', () => {
    expect(watchPerks()).toEqual(nightPerks(NIGHTS.length + 1));
  });

  it('the scorer plays every night, the new one too, with no hard failure', () => {
    const r = scoreLanternkeep({ seeds: 1 });
    expect(r.levels).toHaveLength(NIGHTS.length);
    expect(r.levels.at(-1)!.name).toBe(NIGHTS.at(-1)!.name);
    expect(r.hardFailures).toEqual([]);
  }, 120_000);
});

describe('content grows: Block Barn, a new tap-zone kind and feature (a weathervane)', () => {
  const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const VIEWS: BlockBarnViewport[] = ['390x844', '1024x768'];
  const KINDS = ['block', 'animal', 'tower', 'floor', 'corner', 'door', 'sky', 'vane'];
  const size = (kind: string, vane: number) => (kind === 'corner' ? 46 : kind === 'vane' ? vane : 160);
  const run = (vane: number) => {
    const records: BlockBarnRecord[] = VIEWS.flatMap((viewport) => KINDS.map((kind) => ({ kind, ms: 4, changed: true, w: size(kind, vane), h: size(kind, vane), viewport })));
    const targets: BlockBarnTargetSize[] = VIEWS.flatMap((viewport) => KINDS.map((kind) => ({ kind, viewport, w: size(kind, vane), h: size(kind, vane) })));
    const features = ['name', 'stack', 'knock', 'tumble', 'door', 'sky', 'touch:fx', 'touch:slots', 'touch:bale-bump+fx', 'touch:vane'];
    const gestures: BlockBarnGesture[] = VIEWS.flatMap((viewport) => [1, 2].flatMap((seed) => features.map((feature, i) => ({
      viewport, phase: 'random' as const, seed, gesture: 'tap' as const, on: feature === 'touch:vane' ? 'vane' : 'floor', state: '', responses: 1, signature: `s${i}`, feature, stuck: [],
    }))));
    return scoreBlockBarn(records, { letters: AZ, voiced: AZ, pictured: AZ, flashes: 0, masterGain: 0.5, peakGain: 0.12, leftBarn: false, targets, gestures });
  };

  it('a palm-sized new zone is measured and tapped like the rest, and its feature counts toward variety', () => {
    const r = run(120);
    expect(r.hardFailures).toEqual([]);
    for (const l of r.levels) {
      expect(l.kinds).toContain('vane');
      expect(l.reached).toBe(10);
    }
    expect(r.measures).toEqual({ responsive: 100, noDeadEnds: 100, bigTargets: 100, alphabet: 100, calm: 100, variety: 100 });
  });

  it('a small new zone lowers bigTargets: no zone kind is exempt unless the scorer names it', () => {
    expect(run(40).measures.bigTargets).toBeLessThan(100);
  });
});
