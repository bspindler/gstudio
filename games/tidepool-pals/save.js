// Tidepool Pals save data and economy rules. Pure functions, no DOM.
// Hard rule: no paid path to a random reward. Shells (a random pal) come only from unassisted wins. Pearls are
// sold, so pearls buy only deterministic things (boosters, extra moves, decorations), and anything that helps
// with a level marks the run assisted, which forfeits that win's shell.

export const KEY = 'tidepool_v2', KEY_V1 = 'tidepool_v1';
const START_PEARLS = 120;

export function fresh() {
  return { v: 2, level: 1, stars: {}, pearls: START_PEARLS, shells: 0, sandDollars: 0, album: {}, sources: {}, claimed: {},
    starter: false, decor: {}, settings: { sound: true, haptics: true } };
}

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);

/**
 * Where each pal copy came from: { [id]: { earned, bought } }. Earned = a shell or sand dollars (play);
 * bought = the Starter Pack. Saves from before sources existed carry none, so they are inferred: every copy
 * counts as earned, except that a player who bought the Starter Pack and owns exactly one Snapjaw got that
 * Snapjaw from the pack (bought). With two or more Snapjaws, one is bought and the rest earned.
 */
function migrateSources(raw, album, starter) {
  const out = {};
  const given = obj(raw);
  for (const [id, n0] of Object.entries(album)) {
    const n = Math.max(0, Math.floor(num(n0, 0)));
    if (!n) continue;
    const g = obj(given[id]);
    if ('earned' in g || 'bought' in g) { out[id] = { earned: Math.floor(num(g.earned, 0)), bought: Math.floor(num(g.bought, 0)) }; continue; }
    out[id] = starter && id === STARTER_PAL ? { earned: n - 1, bought: 1 } : { earned: n, bought: 0 };
  }
  return out;
}

/** Any stored value in, a valid v2 save out. v1 saves keep everything and gain stars and sand dollars. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return fresh();
  if (raw.v === 1) {
    const level = Math.max(1, Math.floor(num(raw.level, 1)));
    const album = { ...obj(raw.album) };
    const stars = {};
    for (let n = 1; n < level; n++) stars[n] = 1; // v1 had no stars; passed levels count as cleared
    const sandDollars = Object.values(album).reduce((a, n) => a + Math.max(0, num(n, 0) - 1), 0);
    return { ...fresh(), level, stars, pearls: num(raw.pearls, START_PEARLS), shells: Math.floor(num(raw.shells, 0)),
      sandDollars, album, sources: migrateSources(null, album, !!raw.starter), claimed: { ...obj(raw.claimed) }, starter: !!raw.starter };
  }
  if (raw.v === 2) {
    const f = fresh();
    const album = { ...obj(raw.album) };
    return { ...f, ...raw, v: 2, level: Math.max(1, Math.floor(num(raw.level, 1))), pearls: num(raw.pearls, f.pearls),
      shells: Math.floor(num(raw.shells, 0)), sandDollars: Math.floor(num(raw.sandDollars, 0)),
      stars: { ...obj(raw.stars) }, album, sources: migrateSources(raw.sources, album, !!raw.starter),
      claimed: { ...obj(raw.claimed) }, decor: { ...obj(raw.decor) },
      starter: !!raw.starter, settings: { ...f.settings, ...obj(raw.settings) } };
  }
  return fresh();
}

/** Reads v2, else migrates v1 forward (the v1 key is left in place). Never throws. */
export function loadSave(storage) {
  const read = (k) => { try { const s = storage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } };
  const v2 = read(KEY);
  if (v2) return migrate(v2);
  const v1 = read(KEY_V1);
  const s = migrate(v1);
  if (v1) writeSave(storage, s);
  return s;
}
export function writeSave(storage, S) { try { storage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked: play on */ } }
export function resetProgress(S) { return { ...fresh(), settings: { ...S.settings } }; }

/* ---------- levels and stars ---------- */
/** Saves the best stars, unlocks the next level and works out the pearl reward (replays pay only for new stars). */
export function recordWin(S, n, stars) {
  const prevBest = S.stars[n] || 0;
  const firstClear = prevBest === 0;
  const pearls = firstClear ? 10 + stars * 10 : Math.max(0, stars - prevBest) * 10;
  if (stars > prevBest) S.stars[n] = stars;
  S.level = Math.max(S.level, n + 1);
  S.pearls += pearls;
  return { prevBest, firstClear, pearls };
}

/* ---------- shells (earned only) ---------- */
/** A win drops a shell only if nothing bought helped, and only on a first clear or a better star score. */
export function shellDrop(lvl, prevBest, stars) { return !lvl.assisted && (prevBest === 0 || stars > prevBest); }
/** Banks the win's shell for later. Refuses an assisted run, a win without a drop, or a shell already taken. */
export function bankShell(S, lvl) {
  if (lvl.assisted || !lvl.shellDrop || lvl.shellTaken) return false;
  lvl.shellTaken = true;
  S.shells += 1;
  return true;
}
export function takeShell(S) { if (S.shells <= 0) return false; S.shells -= 1; return true; }

/* ---------- pals and sand dollars ---------- */
/** The pal the Starter Pack (a purchase) includes. */
export const STARTER_PAL = 'snapjaw';
function noteSource(S, id, source) {
  if (!S.sources) S.sources = {};
  const s = S.sources[id] || (S.sources[id] = { earned: 0, bought: 0 });
  if (source === 'bought') s.bought += 1; else s.earned += 1;
}
/** Adds a pal copy. source: 'earned' (a shell or sand dollars) or 'bought' (the Starter Pack). */
export function addPal(S, id, source = 'earned') {
  const n = (S.album[id] || 0) + 1;
  S.album[id] = n;
  noteSource(S, id, source);
  const dup = n > 1;
  if (dup) { S.pearls += 25; S.sandDollars += 1; }
  return { dup, n };
}
const SAND_DOLLAR_COST = { common: 3, rare: 6, epic: 10 };
export function sandDollarCost(rar) { return SAND_DOLLAR_COST[rar] ?? 10; }
/** Sand dollars (from duplicates) buy one specific pal the player is missing. Nothing random. */
export function buyPalWithSandDollars(S, creature) {
  const cost = sandDollarCost(creature.rar);
  if (S.album[creature.id] || S.sandDollars < cost) return false;
  S.sandDollars -= cost;
  S.album[creature.id] = 1;
  noteSource(S, creature.id, 'earned');
  return true;
}

/* ---------- helpers (a pal you bring into a level) ---------- */
/** True if the player got at least one copy of this pal through play (a shell or sand dollars). */
export function palEarned(S, id) { return (S.sources?.[id]?.earned || 0) > 0; }
/**
 * Brings an owned pal into the level as its helper. A pal the player only has from a purchase counts as a
 * boost: the run is assisted and forfeits that win's shell, exactly like a booster.
 */
export function pickHelper(S, lvl, id) {
  if (!id) { lvl.helper = null; return true; }
  if (!S.album[id]) return false;
  lvl.helper = id;
  lvl.helperEarned = palEarned(S, id);
  if (!lvl.helperEarned) { lvl.assisted = true; lvl.shellDrop = false; }
  return true;
}

/* ---------- pearl sinks ---------- */
export const BOOSTERS = [
  { id: 'moves3', name: '+3 Moves', desc: 'Start with 3 extra moves', pearls: 60 },
  { id: 'bomb', name: 'Urchin Start', desc: 'An urchin bomb waits on the board', pearls: 80 },
  { id: 'wave', name: 'Wave Start', desc: 'A wave waits on the board', pearls: 120 },
];
/** Buys pre-level boosters with pearls. Any booster makes the run assisted (no shell on that win). */
export function buyBoosters(S, lvl, ids) {
  const picks = BOOSTERS.filter((b) => ids.includes(b.id));
  const cost = picks.reduce((a, b) => a + b.pearls, 0);
  if (cost > S.pearls) return false;
  S.pearls -= cost;
  lvl.boosters = picks.map((b) => b.id);
  if (picks.length) { lvl.assisted = true; lvl.shellDrop = false; }
  return true;
}

export const DECOR = [
  { id: 'starfish', name: 'Starfish', pearls: 80 },
  { id: 'kelp', name: 'Kelp Garden', pearls: 150 },
  { id: 'anemone', name: 'Anemone', pearls: 200 },
  { id: 'lantern', name: 'Glow Lantern', pearls: 250 },
  { id: 'arch', name: 'Coral Arch', pearls: 350 },
  { id: 'castle', name: 'Sandcastle', pearls: 500 },
];
export function buyDecor(S, id) {
  const d = DECOR.find((x) => x.id === id);
  if (!d || S.decor[id] || S.pearls < d.pearls) return false;
  S.pearls -= d.pearls;
  S.decor[id] = true;
  return true;
}
