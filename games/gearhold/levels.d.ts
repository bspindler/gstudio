// Types for levels.js, so the TypeScript hal scorers can import it. The game itself loads the .js.
export const WALLS: string;
export const FLOOR_THINGS: string;
export const LEVELS: { name: string; hint: string; map: string[]; mood?: Record<string, number | number[]> }[];
