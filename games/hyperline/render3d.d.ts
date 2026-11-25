export const BLOOM3D: { strength: number; radius: number; threshold: number };
/** The 3D renderer, or null when three.js or WebGL is unavailable. Canvases are DOM canvases (typed loosely for node tests). */
export function createRenderer3d(
  canvas: unknown,
  overlay: unknown,
  opts?: { body?: 'm' | 'f' },
): Promise<{ setBody(body: 'm' | 'f'): Promise<void>; info(): { calls: number; triangles: number }; thumb(sk: unknown, px: number, t: number, locked: boolean): unknown; onLost(fn: () => void): void; resize(w: number, h: number, dpr: number): void; render(st: unknown): void; dispose(): void } | null>;
export const STYLE: { safe: string; safe2: string; hazard: string; live: string; gold: string; gold2: string };
export const HERO: { height: number };
export const BODIES: { m: () => Promise<{ default: import('../../scripts/vendor/glb.js').RigData }>; f: () => Promise<{ default: import('../../scripts/vendor/glb.js').RigData }> };
export const THEMES: { name: string; until: number; facade: string; win: string[]; hMin: number; hMax: number; words: string[] }[];
export function themeAt(x: number): { name: string; until: number; facade: string; win: string[]; hMin: number; hMax: number; words: string[] };
