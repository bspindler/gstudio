// Types for figure.js, so the TypeScript tests in packages/core can import it. The game itself loads the .js.
export type FigurePart = { g: 'sphere' | 'cone'; p: [number, number, number]; s: [number, number, number]; col: string; rot?: number; glow?: boolean; soft?: boolean };
export function figureParts(cr: { shape: string; feat: string; col: string }): FigurePart[];
export function figureCamera(parts: FigurePart[], aspect: number, fovDeg?: number): { fov: number; distance: number; centreY: number };
