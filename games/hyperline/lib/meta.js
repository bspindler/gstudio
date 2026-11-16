// Run scoring (near misses, chip streaks), missions and save migration. No DOM; tested in
// packages/core/test/hyperline-meta.test.ts.

import { SECTOR_LEN } from './world.js';

export const CHIP_CR = 3, NEAR_CR = 5;

/** Chip value multiplier: x2 at 8 in a row, x3 at 16, x4 at 24 and beyond. */
export function chipMultiplier(streak) {
  return 1 + Math.min(3, Math.floor(streak / 8));
}

/** Sectors are 1-based for players: sector 1 is 0 to 250m. */
export function newRunStats(mode, start = 1) {
  const from = sectorStart(start), sec = from / SECTOR_LEN + 1;
  return { mode, dist: from, chips: 0, streak: 0, maxStreak: 0, chipPts: 0, near: 0, maxAirSpikes: 0,
    pads: 0, bars: 0, flips: 0, sector: sec, cleanSector: sec, from };
}

/* ---------- practice starts ---------- */

/** Distance where a 1-based sector begins. */
export const sectorStart = (n) => (Math.max(1, Math.floor(n) || 1) - 1) * SECTOR_LEN;
/** A run begun past sector 1 is practice: no BEST, ghost or missions; credits only for distance actually run. */
export const isPractice = (s) => (s.from || 0) > 0;
/** The start sector a player may pick: 1 up to the furthest sector they have reached. */
export function clampStart(n, far) {
  return Math.max(1, Math.min(Math.max(1, Math.floor(far) || 1), Math.floor(n) || 1));
}

export const MAX_URL_SECTOR = 99;
/** Reads ?sector=N from a page address's search string. Whole numbers 1 to 99 only; anything else gives 0 (ignored). */
export function sectorFromSearch(search) {
  const v = new URLSearchParams(search || '').get('sector');
  if (v === null || !/^\d{1,3}$/.test(v.trim())) return 0;
  const n = Number(v);
  return n >= 1 && n <= MAX_URL_SECTOR ? n : 0;
}

/** Folds one sim (or game) event into the run stats. Returns a new object. */
export function applyEvent(s, ev) {
  const n = { ...s };
  switch (ev.t) {
    case 'chip':
      n.chips++; n.streak++; n.maxStreak = Math.max(n.maxStreak, n.streak);
      n.chipPts += CHIP_CR * chipMultiplier(n.streak);
      break;
    case 'chipMiss': n.streak = 0; break;
    case 'near': n.near++; break;
    case 'land': n.maxAirSpikes = Math.max(n.maxAirSpikes, ev.spikes); break;
    case 'pad': n.pads++; break;
    case 'bar': n.bars++; break;
    case 'flipOut': n.flips++; break;
    case 'sector':
      n.sector = Math.max(n.sector, ev.sector);
      if (n.chips === 0) n.cleanSector = Math.max(n.cleanSector, ev.sector);
      break;
  }
  return n;
}

export function runCredits(s) {
  return Math.floor(Math.max(0, s.dist - (s.from || 0)) / 5) + s.chipPts + s.near * NEAR_CR;
}

/** Missions, roughly easy to hard. New ones roll in list order, so progression is predictable. */
export const MISSIONS = [
  { id: 'chips25', text: 'Collect 25 chips in one run', stat: 'chips', target: 25, reward: 80 },
  { id: 'dist300', text: 'Run 300m in one run', stat: 'dist', target: 300, reward: 80 },
  { id: 'near3', text: 'Pull off 3 near misses in one run', stat: 'near', target: 3, reward: 100 },
  { id: 'air3', text: 'Clear 3 spikes in one jump', stat: 'maxAirSpikes', target: 3, reward: 120 },
  { id: 'streak12', text: 'Grab 12 chips in a row', stat: 'maxStreak', target: 12, reward: 100 },
  { id: 'bars4', text: 'Pass under 4 low ceilings in one run', stat: 'bars', target: 4, reward: 120 },
  { id: 'chips40', text: 'Collect 40 chips in one run', stat: 'chips', target: 40, reward: 140 },
  { id: 'daily250', text: 'Reach 250m on the daily run', stat: 'dist', target: 250, reward: 120, mode: 'daily' },
  { id: 'clean3', text: 'Reach sector 3 without grabbing a chip', stat: 'cleanSector', target: 3, reward: 160 },
  { id: 'pads3', text: 'Ride 3 jump pads in one run', stat: 'pads', target: 3, reward: 160 },
  { id: 'dist800', text: 'Run 800m in one run', stat: 'dist', target: 800, reward: 180 },
  { id: 'streak24', text: 'Grab 24 chips in a row', stat: 'maxStreak', target: 24, reward: 160 },
  { id: 'near8', text: 'Pull off 8 near misses in one run', stat: 'near', target: 8, reward: 180 },
  { id: 'sector5', text: 'Reach sector 5', stat: 'sector', target: 5, reward: 220 },
  { id: 'flip2', text: 'Survive 2 gravity flips in one run', stat: 'flips', target: 2, reward: 240 },
];
const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const missionById = (id) => MISSION_BY_ID[id];

export function missionProgress(m, s) {
  if (m.mode && m.mode !== s.mode) return 0;
  return Math.min(m.target, Math.floor(s[m.stat] || 0));
}

/** Ids of the active missions this run has completed. */
export function checkMissions(active, s) {
  if (isPractice(s)) return [];
  return active.filter((id) => { const m = MISSION_BY_ID[id]; return m && missionProgress(m, s) >= m.target; });
}

/** Next mission at or after seq that is not already active. Deterministic. */
export function rollMission(seq, active) {
  const n = MISSIONS.length;
  for (let k = 0; k < n; k++) {
    const m = MISSIONS[(seq + k) % n];
    if (!active.includes(m.id)) return { id: m.id, seq: seq + k + 1 };
  }
  return { id: MISSIONS[seq % n].id, seq: seq + 1 };
}

/* ---------- save ---------- */

export function freshSave() {
  return { v: 3, credits: 150, owned: { volt: 1 }, eq: 'volt', trails: { classic: 1 }, trail: 'classic',
    best: 0, runs: 0, crates: 0, opened: 0, top: [], daily: { day: '', best: 0 },
    missions: ['chips25', 'dist300', 'near3'], missionSeq: 3,
    settings: { sound: true, music: true, haptics: true }, mode: 'endless', far: 1 };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
function counts(o) {
  const out = {};
  if (isObj(o)) for (const [k, v] of Object.entries(o)) if (count(v) > 0) out[k] = count(v);
  return out;
}

/** Brings any earlier save forward to v3 without losing progress; unreadable data starts fresh. */
export function migrateSave(raw) {
  if (!isObj(raw)) return freshSave();
  let s = raw;
  if (s.v === 1) {
    const owned = isObj(s.owned) ? s.owned : { volt: 1 };
    s = { v: 2, credits: s.credits | 0, owned, eq: owned[s.eq] ? s.eq : 'volt', best: s.best | 0, runs: s.runs | 0,
      crates: 0, opened: 0, top: s.best ? [{ run: 0, d: s.best, at: Date.now() }] : [] };
  }
  if (s.v === 2) s = { ...s, v: 3 };
  if (s.v !== 3) return freshSave();

  const f = freshSave();
  const owned = { ...counts(s.owned) };
  if (!owned.volt) owned.volt = 1;
  const trails = { ...counts(s.trails) };
  if (!trails.classic) trails.classic = 1;
  const top = Array.isArray(s.top)
    ? s.top.filter((r) => isObj(r) && Number.isFinite(r.d)).map((r) => ({ run: count(r.run), d: count(r.d), at: Number(r.at) || 0 })).slice(0, 5)
    : [];
  let missions = Array.isArray(s.missions) ? [...new Set(s.missions.filter((id) => typeof id === 'string' && MISSION_BY_ID[id]))].slice(0, 3) : [];
  let seq = Number.isFinite(s.missionSeq) ? count(s.missionSeq) : (missions.length ? 3 : 0);
  if (!Array.isArray(s.missions)) { missions = [...f.missions]; seq = f.missionSeq; }
  while (missions.length < 3) { const m = rollMission(seq, missions); missions.push(m.id); seq = m.seq; }
  const st = isObj(s.settings) ? s.settings : {};
  const daily = isObj(s.daily) && typeof s.daily.day === 'string' ? { day: s.daily.day, best: count(s.daily.best) } : { ...f.daily };
  return {
    v: 3, credits: count(s.credits), owned, eq: owned[s.eq] ? s.eq : 'volt', trails, trail: trails[s.trail] ? s.trail : 'classic',
    best: count(s.best), runs: count(s.runs), crates: count(s.crates), opened: count(s.opened), top, daily,
    missions, missionSeq: seq,
    settings: { sound: st.sound !== false, music: st.music !== false, haptics: st.haptics !== false },
    mode: s.mode === 'daily' ? 'daily' : 'endless',
    // Furthest sector reached; older saves infer it from their best endless distance.
    far: Math.max(1, count(s.far), Math.floor(count(s.best) / SECTOR_LEN) + 1),
  };
}
