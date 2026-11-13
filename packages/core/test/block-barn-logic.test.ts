import { describe, expect, it } from 'vitest';

import { ANIMALS } from '../../../games/block-barn/animals.js';
import { FLOOR, createRotation } from '../../../games/block-barn/rotation.js';
import { TOWER_MAX, createTower } from '../../../games/block-barn/tower.js';

const NAMES = 'ant bear cow duck elephant frog goat horse iguana jellyfish kangaroo lion monkey newt owl pig quail rabbit sheep turtle urchin vulture whale fox yak zebra'.split(' ');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

describe('block-barn animals', () => {
  it('has the 26 letters and names in order', () => {
    expect(ANIMALS.map((a) => a.letter)).toEqual(LETTERS);
    expect(ANIMALS.map((a) => a.name)).toEqual(NAMES);
  });
  it('spells fox with a highlighted x', () => {
    const x = ANIMALS.find((a) => a.letter === 'x')!;
    expect(x.name).toBe('fox');
    expect(x.spell).toBe('fo[x]');
  });
  it('gives every animal a move and a valid sound kind', () => {
    for (const a of ANIMALS) {
      expect(['call', 'move']).toContain(a.sound);
      expect(a.move.length).toBeGreaterThan(0);
    }
  });
});

describe('block-barn rotation', () => {
  it('shows all 26 letters within 26 next calls, never duplicating on the floor', () => {
    for (const seed of [1, 2, 3, 42, 2026]) {
      const r = createRotation(seed);
      expect(r.floor()).toHaveLength(FLOOR);
      for (let i = 0; i < 26; i++) {
        const f = r.next(r.floor()[0]!);
        expect(f).toHaveLength(FLOOR);
        expect(new Set(f).size).toBe(FLOOR);
      }
      expect([...r.seen()].sort()).toEqual(LETTERS);
    }
  });
  it('sees everything after 26 - floor next calls', () => {
    const r = createRotation(7);
    for (let i = 0; i < 26 - FLOOR; i++) r.next(r.floor()[0]!);
    expect(r.seen().size).toBe(26);
  });
  it('is deterministic per seed and differs across seeds', () => {
    const run = (s: number) => { const r = createRotation(s); const o = [...r.floor()]; for (let i = 0; i < 10; i++) o.push(...r.next(r.floor()[0]!)); return o; };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
  it('ignores a letter not on the floor', () => {
    const r = createRotation(3);
    const before = [...r.floor()];
    const off = LETTERS.find((l) => !before.includes(l))!;
    expect(r.next(off)).toEqual(before);
  });
  it('keeps cycling past 26 without duplicates', () => {
    const r = createRotation(9);
    for (let i = 0; i < 80; i++) expect(new Set(r.next(r.floor()[i % FLOOR]!)).size).toBe(FLOOR);
  });
});

describe('block-barn tower', () => {
  it('tumbles on the 6th add and empties', () => {
    const t = createTower();
    expect(TOWER_MAX).toBe(6);
    for (const l of 'abcde') expect(t.add(l)).toBe('added');
    expect(t.blocks()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(t.add('f')).toBe('tumble');
    expect(t.blocks()).toEqual([]);
  });
  it('tumble() returns the blocks it held and empties; blocks() is a copy', () => {
    const t = createTower();
    t.add('a'); t.add('b');
    t.blocks().push('z');
    expect(t.blocks()).toEqual(['a', 'b']);
    expect(t.tumble()).toEqual(['a', 'b']);
    expect(t.blocks()).toEqual([]);
  });
});
