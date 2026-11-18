export const SWELL_SECONDS: number;
export function createSwell(): {
  update(g: { phase: string; queue: unknown[]; enemies: unknown[] }, t: number, reduced?: boolean): number;
};
