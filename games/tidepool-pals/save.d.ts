// Types for save.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
export type Rarity = 'common' | 'rare' | 'epic';
export type Save = {
  v: 2; level: number; stars: Record<number, number>; pearls: number; shells: number; sandDollars: number;
  album: Record<string, number>; claimed: Record<number, boolean>; starter: boolean; decor: Record<string, boolean>;
  settings: { sound: boolean; haptics: boolean };
};
export type LevelRun = { n: number; assisted: boolean; shellDrop: boolean; shellTaken: boolean; boosters?: string[] };
export type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export declare const KEY: string;
export declare const KEY_V1: string;
export declare const BOOSTERS: { id: string; name: string; desc: string; pearls: number }[];
export declare const DECOR: { id: string; name: string; pearls: number }[];
export declare function fresh(): Save;
export declare function migrate(raw: unknown): Save;
export declare function loadSave(storage: Storage): Save;
export declare function writeSave(storage: Storage, S: Save): void;
export declare function resetProgress(S: Save): Save;
export declare function recordWin(S: Save, n: number, stars: number): { prevBest: number; firstClear: boolean; pearls: number };
export declare function shellDrop(lvl: LevelRun, prevBest: number, stars: number): boolean;
export declare function bankShell(S: Save, lvl: LevelRun): boolean;
export declare function takeShell(S: Save): boolean;
export declare function addPal(S: Save, id: string): { dup: boolean; n: number };
export declare function sandDollarCost(rar: Rarity): number;
export declare function buyPalWithSandDollars(S: Save, creature: { id: string; rar: Rarity }): boolean;
export declare function buyBoosters(S: Save, lvl: LevelRun, ids: string[]): boolean;
export declare function buyDecor(S: Save, id: string): boolean;
