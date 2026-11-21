export const WALKERS: Set<string>;
export const STRIDE: number;
export const SIDE: number;
export const CAP: number;
export type Print = { x: number; y: number; h: number; t: number };
export type Footprints = {
  life: number;
  step(e: { id: number; type: string; under?: boolean }, x: number, y: number, t: number): void;
  prune(t: number): void;
  fade(p: Print, t: number): number;
  readonly prints: Print[];
  clear(): void;
};
export function createFootprints(opts?: { life?: number; cap?: number }): Footprints;
