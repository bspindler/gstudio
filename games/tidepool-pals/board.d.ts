// Types for board.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
export declare const COLS: number;
export declare const ROWS: number;

export type SpecialKind = 'bomb' | 'wave-h' | 'wave-v' | 'whirl';
export type PalCell = { id: number; k: 'pal'; c: number; ice?: boolean };
export type SandCell = { id: number; k: 'sand' };
export type SpecialCell = { id: number; k: 'sp'; s: SpecialKind; c: number };
export type Cell = PalCell | SandCell | SpecialCell;
export type Grid = (Cell | null)[][];
export type Pos = [number, number];

export type Goal = { t: 'collect'; c: number; n: number } | { t: 'sand' } | { t: 'ice'; n?: number };
export type LevelDef = { n: number; moves: number; colors: number; goals: Goal[]; layout: string[]; intro?: string; name?: string };
export type Effect = { box?: number; rows?: number[]; cols?: number[]; colors?: number[]; all?: boolean };
export type Counts = { collect: Record<number, number>; sand: number; ice: number };
export type Progress = Counts;
export type Placed = { r: number; c: number; cell: Cell };
export type TapResult =
  | { ok: false }
  | {
    ok: true; kind: 'group' | 'special' | 'combo'; grid: Grid;
    cleared: Placed[]; broke: Placed[]; freed: Placed[]; spawned: Placed | null;
    effects: { r: number; c: number; kind: SpecialKind | 'combo'; effect: Effect; color?: number; parts?: SpecialKind[] }[];
    counts: Counts;
  };

export declare function mulberry32(seed: number): () => number;
export declare function hashSeed(x: number | string): number;
export declare function counter(start?: number): () => number;
export declare function maskOf(def: LevelDef): boolean[][];
export declare function buildBoard(def: LevelDef, rng: () => number, newId: () => number): Grid;
export declare function group(g: Grid, r: number, c: number): Pos[];
export declare function largestGroup(g: Grid): Pos[];
export declare function specialForGroup(cells: Pos[]): SpecialKind | null;
export declare function effectFor(sp: SpecialCell): Effect;
export declare function comboEffect(specials: SpecialCell[]): Effect;
export declare function cellsInEffect(g: Grid, r: number, c: number, e: Effect): Pos[];
export declare function resolveTap(g: Grid, r: number, c: number, newId: () => number): TapResult;
export declare function collapse(g: Grid, mask: boolean[][], rng: () => number, colors: number, newId: () => number):
  { spawned: { id: number; r: number; c: number; fromR: number }[] };
export declare function hasMoves(g: Grid): boolean;
export declare function shuffle(g: Grid, rng: () => number, colors: number, newId: () => number): void;
export declare function newProgress(): Progress;
export declare function addProgress(p: Progress, counts: Partial<Counts>): Progress;
export declare function goalStatus(def: LevelDef, p: Progress): (Goal & { need: number; got: number; done: boolean })[];
export declare function goalsMet(def: LevelDef, p: Progress): boolean;
export declare function starsFor(movesLeft: number, moves: number): 1 | 2 | 3;
