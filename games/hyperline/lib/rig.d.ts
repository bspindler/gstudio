import type * as THREE from 'three';

export type RigData = import('../../../scripts/vendor/glb.js').RigData;
export function decode(s: string, type: 'f32' | 'u16' | 'u32'): Float32Array | Uint16Array | Uint32Array;
export function buildRig(
  T: typeof THREE,
  data: RigData,
  matFor: (materialName: string) => THREE.Material,
): { root: THREE.Group; meshes: THREE.Mesh[]; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction> };
