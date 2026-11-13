// Types for levels.js, so the TypeScript tests can import it. The game itself loads the .js.
import type { Level } from './sim.js';
export const REGIONS: { id: 'moon' | 'frost' | 'ember'; name: string; from: number; blurb: string }[];
export const LEVELS: Level[];
