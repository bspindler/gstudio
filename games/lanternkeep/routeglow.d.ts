export const SWELL_SECONDS: number;
export function swellShape(age: number, len?: number): number;
export type RouteGlow = {
  len: number;
  update(g: { phase: string; waveIndex: number }, t: number): number;
};
export function createRouteGlow(opts?: { len?: number }): RouteGlow;
