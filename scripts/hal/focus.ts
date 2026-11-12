// Which part of a game a change touched, so its before/after shots show it (not always level 1's first second).
// fingerprintGame reads one tree's game data (Gearhold's LEVELS, Tidepool's levelDef(n), Hyperline's course built from
// a fixed seed, grouped by sector) and hashes each level or sector. It runs inside the sandboxed check (check-entry
// `fingerprint`), because it imports the candidate's game code. Hal compares main's fingerprints with the candidate's
// (firstChanged) and shoots that level in both trees. No change in level data (a feel, UI or audio change) keeps the
// default shot.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** One entry per level or sector, in order: a hash of its data and a short label for the report. */
export type Fingerprint = { key: string; label: string }[];

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v) ?? 'undefined').digest('hex').slice(0, 16);
const load = async <T>(root: string, rel: string): Promise<T> => (await import(pathToFileURL(join(root, rel)).href)) as T;

/** Tidepool levels compared: the hand-made ones and 10 generated after them, at least 30 (as the scorer plays). */
const tidepoolCount = (authored: number) => Math.max(30, authored + 10);
/** Hyperline's course is compared up to 150 units into its last sector (as the scorer runs it), from one fixed seed. */
const HYPERLINE_SEED = 1;

export async function fingerprintGame(root: string, game: string): Promise<Fingerprint> {
  switch (game) {
    case 'gearhold': {
      const { LEVELS } = await load<{ LEVELS: Array<{ name?: string }> }>(root, 'games/gearhold/levels.js');
      return LEVELS.map((l, i) => ({ key: hash(l), label: `level ${i + 1}${l.name ? `, ${l.name}` : ''}, from above` }));
    }
    case 'tidepool-pals': {
      const { AUTHORED, levelDef } = await load<{ AUTHORED: unknown[]; levelDef: (n: number) => unknown }>(root, 'games/tidepool-pals/levels.js');
      return Array.from({ length: tidepoolCount(AUTHORED.length) }, (_, i) => ({ key: hash(levelDef(i + 1)), label: `level ${i + 1}` }));
    }
    case 'hyperline': {
      const world = await load<{ SECTORS: Array<{ name?: string }>; SECTOR_LEN: number; sectorAt: (x: number) => number }>(root, 'games/hyperline/lib/world.js');
      const course = await load<{ createCourse: (s: number) => { objs: Array<{ x: number }> }; extendCourse: (c: unknown, x: number) => void }>(root, 'games/hyperline/lib/course.js');
      const c = course.createCourse(HYPERLINE_SEED);
      course.extendCourse(c, (world.SECTORS.length - 1) * world.SECTOR_LEN + 150);
      const per: unknown[][] = world.SECTORS.map(() => []);
      for (const o of c.objs) per[Math.min(world.SECTORS.length - 1, world.sectorAt(o.x))]!.push(o);
      return world.SECTORS.map((s, i) => ({ key: hash([s, per[i]]), label: `sector ${i + 1}${s.name ? `, ${s.name}` : ''}` }));
    }
    default: throw new Error(`fingerprint: no level data for ${game}`);
  }
}

/** The first level or sector whose data differs (a new one counts), or null when none does. */
export function firstChanged(before: Fingerprint, after: Fingerprint): number | null {
  for (let i = 0; i < after.length; i++) if (before[i]?.key !== after[i]!.key) return i;
  return null;
}

/** A fingerprint as it comes back from the sandboxed check: anything else is no fingerprint (the default shot). */
export function asFingerprint(v: unknown): Fingerprint | null {
  if (!Array.isArray(v) || v.length > 500) return null;
  const ok = v.every((e) => e && typeof e === 'object' && typeof (e as { key?: unknown }).key === 'string' && typeof (e as { label?: unknown }).label === 'string');
  return ok ? (v as Fingerprint).map((e) => ({ key: e.key.slice(0, 64), label: e.label.replace(/\s+/g, ' ').slice(0, 80) })) : null;
}
