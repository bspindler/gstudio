// Types for board.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
export declare const COLS: number;
export declare const ROWS: number;

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Phase = 'high' | 'low';
export type SpecialKind = 'bomb' | 'wave-h' | 'wave-v' | 'whirl';
export type PalCell = { id: number; k: 'pal'; c: number; ice?: boolean };
export type SandCell = { id: number; k: 'sand' };
export type LitterCell = { id: number; k: 'litter'; v: number };
export type SpecialCell = { id: number; k: 'sp'; s: SpecialKind; c: number };
export type LostCell = { id: number; k: 'lost' };
export type BubbleCell = { id: number; k: 'bubble'; hp: number };
export type Cell = PalCell | SandCell | LitterCell | SpecialCell | LostCell | BubbleCell;
export type Grid = (Cell | null)[][];
export type Mask = boolean[][];
export type Pos = [number, number];

export type Goal =
  | { t: 'collect'; c: number; n: number } | { t: 'sand' } | { t: 'litter' } | { t: 'ice'; n?: number }
  | { t: 'rescue'; n?: number };
export type Tide = { high: number; low: number; dir: Exclude<Dir, 'down'> };
export type LevelDef = {
  n: number; moves: number; colors: number; goals: Goal[]; layout: string[]; intro?: string; name?: string;
  pool?: number; tide?: Tide; exit?: Dir;
};
export type Effect = {
  box?: number; rows?: number[]; cols?: number[]; colors?: number[]; all?: boolean;
  rect?: [number, number, number, number]; only?: number;
};
export type Counts = { collect: Record<number, number>; sand: number; ice: number; litter: number; rescue?: number };
export type Progress = Counts & { rescue: number };
export type Placed = { r: number; c: number; cell: Cell };
type ResultBase = {
  ok: true; grid: Grid;
  cleared: Placed[]; broke: Placed[]; freed: Placed[]; cracked: Placed[]; released: Placed[]; spawned: Placed | null; recolored: Placed[];
  effects: { r: number; c: number; kind: SpecialKind | 'combo' | 'helper'; effect: Effect; color?: number; parts?: SpecialKind[] }[];
  counts: Counts;
};
export type TapResult = { ok: false } | (ResultBase & { kind: 'group' | 'special' | 'combo' });
export type AbilityResult =
  | { ok: false }
  | (ResultBase & { kind: 'helper'; helper: string; highlight?: Pos[]; double?: boolean; made?: Placed[] });
export type Ability = { name: string; tc: number; charge: number; target: boolean; desc: string };
export type TidePhase = { phase: Phase; dir: Dir; left: number; total: number; nextDir: Dir | null };
export type Spawn = { id: number; r: number; c: number; fromR: number; fromC: number };

export declare const GRAVITY: Record<Dir, [number, number]>;
export declare const ABILITIES: Record<string, Ability>;
export declare function mulberry32(seed: number): () => number;
export declare function hashSeed(x: number | string): number;
export declare function counter(start?: number): () => number;
export declare const BUBBLE_HP: number;
export declare function isFixed(cell: Cell | null): boolean;
export declare function maskOf(def: LevelDef): Mask;
export declare function rockOf(def: LevelDef): Mask;
export declare function activeMask(mask: Mask, rock: Mask | null, phase: Phase): Mask;
export declare function buildBoard(def: LevelDef, rng: () => number, newId: () => number, phase?: Phase): Grid;
export declare function group(g: Grid, r: number, c: number): Pos[];
export declare function largestGroup(g: Grid): Pos[];
export declare function specialForGroup(cells: Pos[]): SpecialKind | null;
export declare function effectFor(sp: SpecialCell): Effect;
export declare function comboEffect(specials: SpecialCell[]): Effect;
export declare function cellsInEffect(g: Grid, r: number, c: number, e: Effect): Pos[];
export declare function resolveTap(g: Grid, r: number, c: number, newId: () => number): TapResult;
export declare function collapse(g: Grid, mask: Mask, rng: () => number, colors: number, newId: () => number, dir?: Dir):
  { spawned: Spawn[] };
export declare function tidePhase(tide: Tide | null | undefined, made: number): TidePhase;
export declare function tideTurns(tide: Tide | null | undefined, made: number): boolean;
export declare function washOut(g: Grid, rock: Mask): { washed: Placed[]; counts: Counts };
export declare function turnTide(g: Grid, mask: Mask, rock: Mask, phase: Phase, dir: Dir, rng: () => number, colors: number,
  newId: () => number): { phase: Phase; dir: Dir; washed: Placed[]; counts: Counts; spawned: Spawn[] };
export declare function atExit(mask: Mask, r: number, c: number, exit: Dir): boolean;
export declare function rescueLost(g: Grid, mask: Mask, exit: Dir | null | undefined): Placed[];
export declare function ensureBubbles(g: Grid, def: LevelDef, mask: Mask, p: Progress): Placed[];
export declare function hasMoves(g: Grid): boolean;
export declare function shuffle(g: Grid, rng: () => number, colors: number, newId: () => number): void;
export declare function helperCharge(counts: Partial<Counts>, id: string): number;
export declare function doubleCounts<C extends Partial<Counts>>(counts: C): C;
export declare function applyAbility(g: Grid, id: string, r: number, c: number, rng: () => number, newId: () => number): AbilityResult;
export declare function newProgress(): Progress;
export declare function addProgress(p: Progress, counts: Partial<Progress>): Progress;
export declare function goalStatus(def: LevelDef, p: Progress): (Goal & { need: number; got: number; done: boolean })[];
export declare function goalsMet(def: LevelDef, p: Progress): boolean;
export declare function starsFor(movesLeft: number, moves: number): 1 | 2 | 3;
