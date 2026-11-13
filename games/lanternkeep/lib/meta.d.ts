// Types for meta.js, so the TypeScript tests can import it. The game itself loads the .js.
import type { Mods } from './sim.js';
export type Perk = { id: string; name: string; desc: string; cost: number; mods: Mods };
export const PERKS: Perk[];
export function sparksSpent(owned: string[]): number;
export function sparksFree(totalStars: number, owned: string[]): number;
export function canTake(totalStars: number, owned: string[], id: string): boolean;
export function modsFor(owned: string[]): Mods;
