export const BLOOM3D: { strength: number; radius: number; threshold: number };
/** The 3D renderer, or null when three.js or WebGL is unavailable. Canvases are DOM canvases (typed loosely for node tests). */
export function createRenderer3d(
  canvas: unknown,
  overlay: unknown,
): Promise<{ onLost(fn: () => void): void; resize(w: number, h: number, dpr: number): void; render(st: unknown): void; dispose(): void } | null>;
