// Types for levels.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
import type { LevelDef } from './board.js';

export type Features = {
  sand: number; litter: number; ice: number; holes: number; rock: number; rescue: number; tide: boolean; sideways: boolean;
  collectGoals: number; goals: number; colors: number;
};
export type PooledLevel = LevelDef & { pool: number };
export declare const HELPER_LEVEL: number;
export declare const AUTHORED: PooledLevel[];
export declare const MOVE_BONUS: Record<number, number>;
export declare function poolOf(n: number): number;
export declare function features(def: LevelDef): Features;
export declare function difficulty(def: LevelDef): number;
export declare function generateLevel(n: number): PooledLevel;
export declare function levelDef(n: number): PooledLevel;
export declare function levelFor(n: number): PooledLevel;
export declare function withoutTides<D extends LevelDef>(def: D): D;
export declare function validateLevel(def: LevelDef): string[];
