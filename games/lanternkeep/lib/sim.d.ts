// Types for sim.js, so the TypeScript tests can import it. The game itself loads the .js.
export type TowerType = 'glowcap' | 'frost' | 'ember' | 'sunspire';
export type EnemyType = 'moth' | 'firefly' | 'beetle' | 'wisp' | 'toad';
export type Tier = { cost: number; dmg: number; rate: number; range: number; slow?: number; slowFor?: number; splash?: number };
export type TowerDef = { name: string; kind: 'bolt' | 'aura' | 'splash' | 'beam'; blurb: string; tiers: Tier[] };
export type EnemyDef = { name: string; hp: number; speed: number; armor: number; reward: number; leak: number; r: number; slowImmune?: boolean };
export type Group = [EnemyType, number, number, number?, number?];
export type Level = {
  name: string; intro: string; lives: number; gold: number; hpMul?: number;
  towers: TowerType[]; paths: [number, number][][]; waves: Group[][];
};
export type Path = { pts: { x: number; y: number }[]; cum: number[]; len: number };
export type Tower = { id: number; type: TowerType; c: number; r: number; x: number; y: number; tier: number; cd: number; spent: number; aim: number };
export type Enemy = {
  id: number; type: EnemyType; lane: number; hp: number; maxHp: number; d: number; x: number; y: number;
  slow: number; slowLeft: number; hitFlash: number; leaked?: boolean;
};
export type Game = {
  level: Level; paths: Path[]; blocked: Set<string>; lantern: { c: number; r: number };
  gold: number; lives: number; maxLives: number; waveIndex: number; waveCount: number;
  queue: { t: number; type: EnemyType; lane: number }[]; countdown: number | null; t: number;
  phase: 'ready' | 'wave' | 'won' | 'lost'; towers: Tower[]; enemies: Enemy[]; nextId: number;
  stats: { kills: number; leaks: number; earned: number; earlyBonus: number; built: number };
};
export type SimEvent =
  | { e: 'kill'; type: EnemyType; x: number; y: number; reward: number }
  | { e: 'leak'; type: EnemyType; lives: number }
  | { e: 'pulse'; id: number; x: number; y: number; range: number }
  | { e: 'burst'; id: number; x1: number; y1: number; x2: number; y2: number; splash: number }
  | { e: 'bolt' | 'beam'; id: number; x1: number; y1: number; x2: number; y2: number }
  | { e: 'wave'; n: number }
  | { e: 'won'; stars: number }
  | { e: 'lost' };

export const COLS: number;
export const ROWS: number;
export const DT: number;
export const BREAK_SECONDS: number;
export const EARLY_GOLD_PER_SECOND: number;
export const SELL_REFUND: number;
export const TOWERS: Record<TowerType, TowerDef>;
export const TOWER_ORDER: TowerType[];
export const ENEMIES: Record<EnemyType, EnemyDef>;
export function buildPath(points: [number, number][]): Path;
export function pointAt(path: Path, d: number): { x: number; y: number };
export function pathCells(points: [number, number][]): [number, number][];
export function createGame(level: Level): Game;
export function canBuild(g: Game, c: number, r: number): boolean;
export function towerAt(g: Game, c: number, r: number): Tower | null;
export function stats(t: Tower): Tier;
export function upgradeCost(t: Tower): number | null;
export function refundFor(g: Game, t: Tower): number;
export function place(g: Game, type: string, c: number, r: number): '' | 'locked' | 'blocked' | 'gold';
export function upgrade(g: Game, id: number): '' | 'missing' | 'max' | 'gold';
export function sell(g: Game, id: number): number;
export function canCallWave(g: Game): boolean;
export function callWave(g: Game): number;
export function step(g: Game): SimEvent[];
export function starsFor(g: Game): number;
export function coverage(g: Game, c: number, r: number, range: number): number;
