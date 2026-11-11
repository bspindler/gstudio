// The notes/approvals/spend commands with a temp halDir and a fixed clock.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCORERS } from '@studio/core/hal';
import { main } from './cli.js';
import { createStore } from './store.js';

let out: string[], err: string[], halDir: string, clock: Date;
beforeEach(async () => {
  out = []; err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
  halDir = await mkdtemp(join(tmpdir(), 'hal-clistore-'));
  clock = new Date(2026, 10, 11, 9, 0, 0);
});
afterEach(() => vi.restoreAllMocks());
const run = (...argv: string[]) => main(argv, { scorers: SCORERS, halDir, now: () => clock });

describe('hal tell / notes', () => {
  it('tell stores an open note, optionally for a game', async () => {
    expect(await run('tell', 'make gearhold scarier')).toBe(0);
    expect(await run('tell', 'rounder tiles', '--game', 'tidepool-pals')).toBe(0);
    expect(out).toEqual(['noted N-001', 'noted N-002 (tidepool-pals)']);
    const notes = JSON.parse(await readFile(join(halDir, 'notes.json'), 'utf8'));
    expect(notes.map((n: { id: string; game: string | null; status: string }) => [n.id, n.game, n.status])).toEqual([['N-001', null, 'open'], ['N-002', 'tidepool-pals', 'open']]);
  });
  it('tell rejects empty text and an unknown game', async () => {
    expect(await run('tell')).toBe(1);
    expect(await run('tell', '   ')).toBe(1);
    expect(await run('tell', 'x', '--game', 'pong')).toBe(1);
    expect(err.join('\n')).toMatch(/unknown game/);
  });
  it('notes lists them with status; empty says so; --clear removes one', async () => {
    expect(await run('notes')).toBe(0);
    expect(out).toEqual(['no notes']);
    out.length = 0;
    await run('tell', 'a'); await run('tell', 'b');
    out.length = 0;
    expect(await run('notes')).toBe(0);
    expect(out).toEqual(['N-001 [open] (any game) a', 'N-002 [open] (any game) b']);
    expect(await run('notes', '--clear', 'N-001')).toBe(0);
    expect((await createStore({ halDir }).readNotes()).map((n) => n.id)).toEqual(['N-002']);
    expect(await run('notes', '--clear', 'N-001')).toBe(1);
    expect(err.join('\n')).toMatch(/no note N-001/);
  });
});

describe('hal approve', () => {
  it('records an approval and is idempotent', async () => {
    expect(await run('approve', 'font host fonts.example.com')).toBe(0);
    expect(await run('approve', 'font host fonts.example.com')).toBe(0);
    expect(await createStore({ halDir }).readApprovals()).toHaveLength(1);
    expect(out[0]).toMatch(/approved: font host/);
  });
  it('needs an item', async () => expect(await run('approve')).toBe(1));
});

describe('hal spend', () => {
  it('shows today and the last 7 days split by billing against the cap', async () => {
    const s = createStore({ halDir, now: () => clock });
    await s.saveSpendDay({ day: '2026-11-11', calls: [
      { run: 'r', role: 'planner', billing: 'api', usd: 1.5, at: 't' },
      { run: 'r', role: 'implementer', billing: 'subscription', usd: 4, at: 't' },
    ] });
    await s.saveSpendDay({ day: '2026-11-09', calls: [{ run: 'r0', role: 'planner', billing: 'api', usd: 0.25, at: 't' }] });
    await s.saveSpendDay({ day: '2026-10-01', calls: [{ run: 'r0', role: 'planner', billing: 'api', usd: 9, at: 't' }] });
    expect(await run('spend')).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/today \(2026-11-11\): api \$1\.50 of \$20\.00 cap, subscription \$4\.00/);
    expect(text).toMatch(/2026-11-09 +api \$0\.25 +subscription \$0\.00/);
    expect(text).not.toMatch(/2026-10-01/);
  });
  it('with no spend at all shows zeros', async () => {
    expect(await run('spend')).toBe(0);
    expect(out.join('\n')).toMatch(/today \(2026-11-11\): api \$0\.00 of \$20\.00 cap, subscription \$0\.00/);
  });
});
