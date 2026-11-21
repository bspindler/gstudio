import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHARD_LIFE, makeShards, shardAlpha } from '../../../games/hyperline/render.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');

describe('hyperline crash shards', () => {
  it('fade out in under half a second', () => {
    expect(SHARD_LIFE).toBeLessThan(0.5);
    expect(shardAlpha(0)).toBeGreaterThan(0.5);
    expect(shardAlpha(0)).toBeLessThanOrEqual(1);
    expect(shardAlpha(SHARD_LIFE / 2)).toBeLessThan(shardAlpha(0));
    expect(shardAlpha(SHARD_LIFE)).toBe(0);
    expect(shardAlpha(SHARD_LIFE * 2)).toBe(0);
  });
  it('makes a few shards flying outward from the crash point', () => {
    let i = 0;
    const rand = () => ((i++ * 0.37) % 1);
    const s = makeShards(10, 1, 9, rand);
    expect(s.length).toBe(9);
    for (const p of s) {
      expect(p.x).toBe(10);
      expect(p.y).toBe(1);
      expect(p.age).toBe(0);
      expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(0);
    }
  });
  it('is render-side only and honours reduced motion', () => {
    expect(html).toMatch(/G\.shards\s*=/);
    expect(html).toMatch(/shards:\s*reduced \? \[\] : G\.shards/);
  });
});
