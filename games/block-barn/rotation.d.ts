export declare const FLOOR: number;
export type Rotation = { floor(): string[]; next(taken: string): string[]; seen(): Set<string> };
export declare function createRotation(seed: number, floor?: number): Rotation;
