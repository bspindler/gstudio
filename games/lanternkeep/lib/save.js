// Lanternkeep progress, kept in the browser. Pure helpers; the page does the reading and writing.
export const SAVE_KEY = 'lanternkeep.v1';

export function emptySave() {
  return { v: 1, stars: [], sound: true, speed: 1 };
}

export function parseSave(raw) {
  try {
    const o = JSON.parse(raw ?? '');
    if (!o || o.v !== 1) return emptySave();
    return {
      ...emptySave(),
      stars: Array.isArray(o.stars) ? o.stars.map((n) => Math.max(0, Math.min(3, Math.floor(Number(n) || 0)))) : [],
      sound: o.sound !== false,
      speed: o.speed === 2 ? 2 : 1,
    };
  } catch {
    return emptySave();
  }
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
