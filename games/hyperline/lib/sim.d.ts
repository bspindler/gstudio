import type { Course, Obj } from './course.js';

export type Runner = {
  x: number; y: number; vy: number; grounded: boolean; flip: boolean; rot: number;
  air: number; steps: number; dead: string; landed: boolean;
};
export type SimEvent =
  | { t: 'jump' | 'clear' | 'pad' | 'bar' | 'rail' | 'chipMiss' | 'flipIn' | 'flipOut' }
  | { t: 'land'; spikes: number }
  | { t: 'near'; margin: number; x: number; y: number }
  | { t: 'chip'; x: number; y: number }
  | { t: 'die'; cause: string };
export function createRunner(): Runner;
export function moverH(o: Obj, x: number): number;
export function blockX(o: Obj, x0: number): number;
export function railLit(o: Obj, x: number): boolean;
export function step(r: Runner, c: Course, jump: boolean): SimEvent[];
