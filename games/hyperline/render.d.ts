import type { Camera } from './lib/proj.js';

export function cameraFor(
  st: { rx: number; lift: number; flipT: number; shakeX: number; shakeY: number },
  W: number,
  H: number,
): Camera;
