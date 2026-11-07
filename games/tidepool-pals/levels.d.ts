// Types for levels.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
import type { LevelDef } from './board.js';

export declare const AUTHORED: LevelDef[];
export declare function features(def: LevelDef):
  { sand: number; ice: number; holes: number; collectGoals: number; goals: number; colors: number };
export declare function difficulty(def: LevelDef): number;
export declare function generateLevel(n: number): LevelDef;
export declare function levelDef(n: number): LevelDef;
export declare function validateLevel(def: LevelDef): string[];
