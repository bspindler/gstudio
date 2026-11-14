import type { Camera } from './lib/proj.js';

export const BLOOM: { strength: number; radius: number; threshold: number };
export function createBloom(
  glCanvas: HTMLCanvasElement,
  src: HTMLCanvasElement,
): Promise<{ onLost(fn: () => void): void; resize(w: number, h: number): void; present(): void; dispose(): void } | null>;

export function cameraFor(
  st: { rx: number; lift: number; flipT: number; shakeX: number; shakeY: number },
  W: number,
  H: number,
): Camera;
