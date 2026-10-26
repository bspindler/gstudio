import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsObjectStore } from '../src/index.js';

const fresh = () => createFsObjectStore(mkdtempSync(join(tmpdir(), 'objs-')));

describe('createFsObjectStore', () => {
  it('round-trips a body', async () => {
    const s = fresh();
    await s.put('events/day=2026-10-26/game=g/a.ndjson', 'x\n');
    expect(await s.get('events/day=2026-10-26/game=g/a.ndjson')).toBe('x\n');
  });
  it('returns undefined for a missing key', async () => {
    expect(await fresh().get('nope/x')).toBeUndefined();
  });
  it('lists keys under a prefix, sorted', async () => {
    const s = fresh();
    for (const k of ['events/b/2', 'events/a/1', 'clips/c', 'events/b/1']) await s.put(k, k);
    expect(await s.list('events/')).toEqual(['events/a/1', 'events/b/1', 'events/b/2']);
    expect(await s.list('missing/')).toEqual([]);
  });
  it('rejects traversal and absolute keys', async () => {
    const s = fresh();
    await expect(s.put('../escape', 'x')).rejects.toThrow(/invalid key/);
    await expect(s.put('/etc/x', 'x')).rejects.toThrow(/invalid key/);
    await expect(s.get('a/../../b')).rejects.toThrow(/invalid key/);
    await expect(s.list('..')).rejects.toThrow(/invalid key/);
  });
});
