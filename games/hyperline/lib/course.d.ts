export type Obj = {
  t: 'spike' | 'block' | 'pit' | 'chip' | 'bar' | 'pad' | 'mover' | 'flip' | 'gate' | 'rail';
  x: number; y?: number; w?: number; h?: number; inv?: boolean; per?: number;
  c?: number; glow?: number; drop?: number;
  sl?: number; m?: number;
  base?: number; amp?: number; k?: number; ph?: number;
  p?: string; g?: number; got?: boolean; miss?: boolean; done?: boolean; mc?: number;
};
export type Pattern = { id: string; sector: number; weight(s: number): number; build(x: number, d: number, r: () => number, intro?: boolean): { o: Obj[]; len: number } };
export type Course = { seed: number; rng: () => number; objs: Obj[]; nextX: number; introduced: number[]; last: string; count: number };
export const PATTERNS: Pattern[];
export const INTRO: Record<number, string>;
export function createCourse(seed: number, startX?: number): Course;
export function extendCourse(c: Course, untilX: number): void;
export function lowerBound(objs: Obj[], v: number): number;
export function pruneCourse(c: Course, x: number): void;
