// Types for press.js, so the TypeScript hal bot can read the press beat. The game itself loads the .js.
export const PRESS: { period: number; warn: number; down: number; dmg: number };
export function pressOffset(x: number): number;
export function pressState(t: number, x: number): 'open' | 'warn' | 'down';
