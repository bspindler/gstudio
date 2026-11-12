// Gear-key checkpoint: picking up a level's gear key remembers where you are, so a wreck after that respawns
// you at the key instead of the level start. Saved only in this device's localStorage (no network).
// Pure, so it can be tested without a browser. Machines scrapped, items taken and doors opened before the
// key stay that way; the player reboots at full integrity with the key, weapon and shells they had.

const SHELLS_MAX = 50;
const ints = (a) => Array.isArray(a) && a.every((n) => Number.isInteger(n) && n >= 0);

/** A plain, storable checkpoint. dead / taken / doors are indices (enemies, items, map cells). */
export function makeCheckpoint({ level, x, y, shells, scatter, dead, taken, doors }) {
  return {
    level, x, y,
    shells: Math.max(0, Math.min(SHELLS_MAX, Math.floor(shells))),
    scatter: !!scatter,
    dead: [...dead], taken: [...taken], doors: [...doors],
  };
}

/** The stored checkpoint, or null when missing, malformed, out of range or not on an open cell. */
export function parseCheckpoint(raw, levels, walls) {
  if (!raw) return null;
  let c;
  try { c = JSON.parse(raw); } catch { return null; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  if (!Number.isInteger(c.level) || c.level < 0 || c.level >= levels.length) return null;
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.shells)) return null;
  const map = levels[c.level].map, cell = map[Math.floor(c.y)]?.[Math.floor(c.x)];
  if (cell === undefined || walls.includes(cell) || cell === 'D' || cell === 'K') return null;
  if (!ints(c.dead) || !ints(c.taken) || !ints(c.doors) || typeof c.scatter !== 'boolean') return null;
  return makeCheckpoint(c);
}
