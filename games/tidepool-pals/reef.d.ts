// Types for reef.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
import type { Save } from './save.js';

export type Palette = { top: string; bottom: string; accent: string };
export type Scenery = { id: string; name: string };
export type PoolInfo = { index: number; name: string; palette: Palette; scenery: Scenery; authored: boolean };
export type Stage = { id: 'polluted' | 'cleaning' | 'recovering' | 'thriving'; name: string; at: number };
export type PoolProgress = {
  pool: number; levels: number[]; cleared: number; total: number; fraction: number; stars: number; maxStars: number;
  stage: number; unlocked: boolean; current: boolean;
};
export type StageUp = { pool: number; from: number; to: number };
export type ThrivingReward = { pearls: number; decor: string };
export type HomeScenery = { pool: number; id: string; accent: string; name: string };
export type FieldNotes = { animal: string; lines: string[] };

export declare const POOL_SIZE: number;
export declare const SCENERY: Scenery[];
export declare const STAGES: Stage[];
export declare const PAL_HOME: Record<string, number>;
export declare const FIELD_NOTES: Record<string, FieldNotes>;
export declare const DID_YOU_KNOW: string[][];

export declare function poolOf(n: number, lookup?: (n: number) => { pool?: number } | null | undefined): number;
export declare function poolLevels(p: number): number[];
export declare function poolInfo(p: number): PoolInfo;
export declare function stageFor(fraction: number): number;
export declare function poolProgress(S: Save, p: number): PoolProgress;
export declare function reefPools(S: Save): PoolProgress[];
export declare function initReef(S: Save): Save;
export declare function takeStageUps(S: Save): StageUp[];
export declare function thrivingReward(p: number): ThrivingReward;
export declare function pendingThriving(S: Save): number[];
export declare function claimThriving(S: Save, p: number): ThrivingReward | null;
export declare function homeScenery(S: Save): HomeScenery[];
export declare function residents(S: Save, order: string[]): Record<number, string[]>;
export declare function didYouKnow(p: number, stage: number): string;
