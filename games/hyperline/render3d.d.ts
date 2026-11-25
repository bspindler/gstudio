export const BLOOM3D: { strength: number; radius: number; threshold: number };
/** The 3D renderer, or null when three.js or WebGL is unavailable. Canvases are DOM canvases (typed loosely for node tests). */
export function createRenderer3d(
  canvas: unknown,
  overlay: unknown,
): Promise<{ info(): { calls: number; triangles: number }; thumb(sk: unknown, px: number, t: number, locked: boolean): unknown; onLost(fn: () => void): void; resize(w: number, h: number, dpr: number): void; render(st: unknown): void; dispose(): void } | null>;
export const STYLE: { safe: string; safe2: string; hazard: string; live: string; gold: string; gold2: string };
export const ROBOT: { scale: number; jumpFrom: number; jumpHold: number };
export const THEMES: { name: string; until: number; facade: string; win: string[]; hMin: number; hMax: number; words: string[] }[];
export function themeAt(x: number): { name: string; until: number; facade: string; win: string[]; hMin: number; hMax: number; words: string[] };
