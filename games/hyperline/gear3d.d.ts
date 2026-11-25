import type { Outfit } from './outfit3d.js';
export const HAIRS: Record<string, () => Promise<{ default: import('../../scripts/vendor/glb.js').Attachment }>>;
export const SKIN_TONES: string[];
export const GEAR: string[];
export function loadHair(names: (string | null)[]): Promise<Record<string, import('../../scripts/vendor/glb.js').Attachment>>;
export function hairFor(look: Outfit, body: 'm' | 'f'): string[];
export function dress(T: unknown, rig: unknown, look: Outfit, body: 'm' | 'f', hair: Record<string, unknown>, headTop?: number): { parts: unknown[]; update(s: { t?: number; speed?: number; air?: boolean; trim?: string }): void; dispose(): void };
