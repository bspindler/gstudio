export declare const TOWER_MAX: number;
export type Tower = { blocks(): string[]; add(letter: string): 'added' | 'tumble'; tumble(): string[] };
export declare function createTower(max?: number): Tower;
