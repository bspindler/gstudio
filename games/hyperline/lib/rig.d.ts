import type * as THREE from 'three';

export type RigData = import('../../../scripts/vendor/glb.js').RigData;
export function decode(s: string, type: 'f32' | 'u16' | 'u32' | 'i16' | 'i8' | 'u8'): Float32Array | Uint16Array | Uint32Array | Int16Array | Int8Array | Uint8Array;
export function decodePrim(p: import('../../../scripts/vendor/glb.js').RigPrim): { pos: Float32Array; nrm: Float32Array; j: Uint16Array | null; w: Float32Array | null };
export function buildRig(
  T: typeof THREE,
  data: RigData,
  matFor: (materialName: string) => THREE.Material,
): { root: THREE.Group; meshes: THREE.Mesh[]; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction> };
