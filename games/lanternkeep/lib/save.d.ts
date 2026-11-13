// Types for save.js, so the TypeScript tests can import it. The game itself loads the .js.
export type Save = { v: 1; stars: number[]; sound: boolean; speed: 1 | 2 };
export const SAVE_KEY: string;
export function emptySave(): Save;
export function parseSave(raw: string | null | undefined): Save;
export function recordStars(save: Save, index: number, stars: number): Save;
export function isUnlocked(save: Save, index: number): boolean;
export function totalStars(save: Save): number;
