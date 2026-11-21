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

export function cameraFor(
  st: { rx: number; lift: number; flipT: number; shakeX: number; shakeY: number },
  W: number,
  H: number,
): Camera;
