// Lanternkeep progress, kept in the browser. Pure helpers; the page does the reading and writing.
// v2 adds perks, settings, reveal cards already seen, and the best Night Watch wave. v1 saves migrate.
export const SAVE_KEY = 'lanternkeep.v2';
export const OLD_KEY = 'lanternkeep.v1';

export function emptySave() {
  return { v: 2, stars: [], perks: [], seen: [], endlessBest: 0, sound: true, haptics: true, lowFx: false, speed: 1 };
}

const clampStars = (a) => (Array.isArray(a) ? a.map((n) => Math.max(0, Math.min(3, Math.floor(Number(n) || 0)))) : []);
const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 200) : []);

export function parseSave(raw, oldRaw) {
  try {
    const o = JSON.parse(raw ?? 'null');
    if (o && o.v === 2) {
      return {
        ...emptySave(),
        stars: clampStars(o.stars),
        perks: strings(o.perks),
        seen: strings(o.seen),
        endlessBest: Math.max(0, Math.floor(Number(o.endlessBest) || 0)),
        sound: o.sound !== false,
        haptics: o.haptics !== false,
        lowFx: o.lowFx === true,
        speed: o.speed === 2 ? 2 : 1,
      };
    }
  } catch { /* fall through */ }
  try {
    const v1 = JSON.parse(oldRaw ?? 'null');
    if (v1 && v1.v === 1) return { ...emptySave(), stars: clampStars(v1.stars), sound: v1.sound !== false, speed: v1.speed === 2 ? 2 : 1 };
  } catch { /* fall through */ }
  return emptySave();
}

// Keeps the best result for a level: replaying never lowers stars.
export function recordStars(save, index, stars) {
  const s = [...save.stars];
  while (s.length <= index) s.push(0);
  s[index] = Math.max(s[index], stars);
  return { ...save, stars: s };
}

export function isUnlocked(save, index) {
  return index === 0 || (save.stars[index - 1] ?? 0) > 0;
}

export function totalStars(save) {
  return save.stars.reduce((a, b) => a + b, 0);
}

export function markSeen(save, id) {
  return save.seen.includes(id) ? save : { ...save, seen: [...save.seen, id] };
}
