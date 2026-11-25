import type { Camera } from './lib/proj.js';

export const BLOOM: { strength: number; radius: number; threshold: number };
export function createBloom(
  glCanvas: HTMLCanvasElement,
  src: HTMLCanvasElement,
): Promise<{ onLost(fn: () => void): void; resize(w: number, h: number): void; present(): void; dispose(): void } | null>;

export const SECTOR_HUE: { deg: number; secs: number };
export function hueShiftHex(hex: string, deg: number): string;
export function sectorHueShift(x: number): number;

export function squashScale(q: number): { sx: number; sy: number };
export const LIGHT_TRAIL_LIFE: number;
export function lightTrailAlpha(age: number): number;
export interface Shard { x: number; y: number; z: number; vx: number; vy: number; vz: number; rot: number; spin: number; len: number; age: number }
export const SHARD_LIFE: number;
export function shardAlpha(age: number): number;
export const TICK: { max: number; reach: number; fadeIn: number; fadeOut: number };
export function tickAlpha(ahead: number): number;
export function takeoffTicks(objs: any[], rcx: number): { x: number; a: number }[];
export function makeShards(x: number, y: number, n: number, rand: () => number): Shard[];

export function cameraFor(
  st: { rx: number; lift: number; flipT: number; shakeX: number; shakeY: number; kick?: number; speed?: number },
  W: number,
  H: number,
): Camera;

export function paletteAt(x: number): { sky: string[]; sun: string[]; grid: string; rail: string; neon: string; block: string };
export function mixHex(a: string, b: string, t: number): string;
export function skinColors(sk: { a: string; b: string; fx?: string }, t: number): [string, string];
export function drawOverlay(c: unknown, W: number, H: number, st: any): boolean;
