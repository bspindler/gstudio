// Types for save.js, so the TypeScript tests can import it. The game itself loads the .js.
export type Save = {
  v: 2; stars: number[]; perks: string[]; seen: string[]; endlessBest: number;
  sound: boolean; haptics: boolean; lowFx: boolean; speed: 1 | 2;
};
export const SAVE_KEY: string;
export const OLD_KEY: string;
export function emptySave(): Save;
export function parseSave(raw: string | null | undefined, oldRaw?: string | null): Save;
export function recordStars(save: Save, index: number, stars: number): Save;
export function isUnlocked(save: Save, index: number): boolean;
export function totalStars(save: Save): number;
export function markSeen(save: Save, id: string): Save;
