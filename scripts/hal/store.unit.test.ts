import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { writeJsonAtomic, createStore, defaultHalDir, KEEP_SPEND_DAYS } from './store.js';

let dir: string, clock: Date;
const mk = () => createStore({ halDir: dir, now: () => clock });
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hal-store-')); clock = new Date(2026, 10, 11, 1, 0, 0); });

describe('store', () => {
  it('defaults to <repo>/.data/hal', () => expect(defaultHalDir()).toMatch(/\.data[\\/]hal$/));
  it('writes atomically: no temp file left, parent dirs created', async () => {
    await writeJsonAtomic(join(dir, 'a', 'b.json'), { x: 1 });
    expect(JSON.parse(await readFile(join(dir, 'a', 'b.json'), 'utf8'))).toEqual({ x: 1 });
    expect(await readdir(join(dir, 'a'))).toEqual(['b.json']);
  });
  it('a failed write leaves the old file intact', async () => {
    await writeJsonAtomic(join(dir, 'a.json'), { ok: true });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    await expect(writeJsonAtomic(join(dir, 'a.json'), circular)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(dir, 'a.json'), 'utf8'))).toEqual({ ok: true });
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('notes: sequential ids, injected timestamp, round trip', async () => {
    const s = mk();
    expect(await s.readNotes()).toEqual([]);
    const a = await s.addNote({ text: 'make it juicier', game: 'tidepool-pals' });
    clock = new Date(2026, 10, 12, 1, 0, 0);
    const b = await s.addNote({ text: 'general', game: null });
    expect([a.id, b.id]).toEqual(['N-001', 'N-002']);
    expect(a).toEqual({ id: 'N-001', at: new Date(2026, 10, 11, 1).toISOString(), game: 'tidepool-pals', text: 'make it juicier', status: 'open' });
    expect(await mk().readNotes()).toEqual([a, b]);
  });
  it('note ids continue from the existing notes, not from the count', async () => {
    const s = mk();
    await s.addNote({ text: 'a', game: null }); await s.addNote({ text: 'b', game: null });
    expect(await s.clearNote('N-001')).toBe(true);
    expect((await s.addNote({ text: 'c', game: null })).id).toBe('N-003');
    expect(await s.clearNote('N-999')).toBe(false);
  });
  it('setNote updates status and reply', async () => {
    const s = mk();
    await s.addNote({ text: 'a', game: null });
    expect(await s.setNote('N-001', { status: 'acted', reply: 'done' })).toBe(true);
    expect((await s.readNotes())[0]).toMatchObject({ status: 'acted', reply: 'done' });
    expect(await s.setNote('N-404', { status: 'asked' })).toBe(false);
  });
  it('a corrupt notes.json is an error, not an empty list', async () => {
    await writeJsonAtomic(join(dir, 'notes.json'), { not: 'an array' });
    await expect(mk().readNotes()).rejects.toThrow(/notes\.json/);
  });

  it('approvals round trip, by brian, deduped by item', async () => {
    const s = mk();
    await s.addApproval('font host fonts.example.com');
    await s.addApproval('Font host fonts.example.com');
    expect(await s.readApprovals()).toEqual([{ item: 'font host fonts.example.com', at: clock.toISOString(), by: 'brian' }]);
  });
  it('feedback records votes and undo reasons', async () => {
    const s = mk();
    expect(await s.readFeedback()).toEqual({ votes: [], undos: [] });
    await s.addVote({ run: 'r1', item: 'c1', game: 'gearhold', vote: 'down' });
    await s.addUndo({ run: 'r1', reason: 'too bouncy' });
    expect(await s.readFeedback()).toEqual({
      votes: [{ run: 'r1', item: 'c1', game: 'gearhold', vote: 'down', at: clock.toISOString() }],
      undos: [{ run: 'r1', reason: 'too bouncy', at: clock.toISOString() }],
    });
  });

  it('feedbackFor filters by run, newest last, and a vote comment round-trips', async () => {
    const s = mk();
    await s.addVote({ run: 'r1', item: 'a', vote: 'up', comment: 'love it' });
    await s.addVote({ run: 'r2', item: 'b', vote: 'down' });
    await s.addVote({ run: 'r1', item: 'c', vote: 'down' });
    await s.addUndo({ run: 'r2', reason: 'nope' });
    await s.addUndo({ run: 'r1', reason: 'meh' });
    const f = await s.feedbackFor('r1');
    expect(f.votes.map((v) => v.item)).toEqual(['a', 'c']);
    expect(f.votes[0]!.comment).toBe('love it');
    expect(f.undos.map((u) => u.reason)).toEqual(['meh']);
    expect(await s.feedbackFor('zzz')).toEqual({ votes: [], undos: [] });
  });

  it('spend: loadSpendToday is empty for a new day, save keeps one SpendDay per day', async () => {
    const s = mk();
    expect(await s.loadSpendToday()).toEqual({ day: '2026-11-11', calls: [] });
    const day = { day: '2026-11-11', calls: [{ run: 'r', role: 'planner', billing: 'api' as const, usd: 1.25, at: 't' }] };
    await s.saveSpendDay(day);
    await s.saveSpendDay({ ...day, calls: [...day.calls, { ...day.calls[0]!, usd: 2 }] });
    expect(await s.readSpend()).toHaveLength(1);
    expect((await s.loadSpendToday()).calls).toHaveLength(2);
    clock = new Date(2026, 10, 12, 1);
    expect(await s.loadSpendToday()).toEqual({ day: '2026-11-12', calls: [] });
  });
  it('spend keeps only the newest 60 days, sorted', async () => {
    const s = mk();
    for (let i = 70; i >= 1; i--) await s.saveSpendDay({ day: `2026-${i > 31 ? '09' : '10'}-${String(((i - 1) % 31) + 1).padStart(2, '0')}`, calls: [] });
    const days = await s.readSpend();
    expect(days).toHaveLength(KEEP_SPEND_DAYS);
    expect([...days].map((d) => d.day)).toEqual([...days].map((d) => d.day).sort());
  });

  it('runDir is under runs/<id> and rejects path tricks', () => {
    const s = mk();
    expect(s.runDir('2026-11-11')).toBe(join(dir, 'runs', '2026-11-11'));
    expect(() => s.runDir('../x')).toThrow();
  });
});

describe('store: run-time additions (Task 7)', () => {
  it('recordUndo updates the unfinished entry for a pass; pendingUndos lists pending/failed, newest per pass', async () => {
    const s = createStore({ halDir: await mkdtemp(join(tmpdir(), 'hal-store-t7-')), now: () => new Date('2026-11-12T03:00:00Z') });
    await s.recordUndo({ pass: 'HAL-001', run: 'r1', reason: 'too bouncy', status: 'failed', error: 'conflict' });
    await s.recordUndo({ pass: 'HAL-002', run: 'r1', reason: 'meh', status: 'pending' });
    expect((await s.pendingUndos()).map((u) => u.pass)).toEqual(['HAL-001', 'HAL-002']);
    await s.recordUndo({ pass: 'HAL-001', run: 'r2', reason: 'too bouncy', status: 'done', commit: 'abc' });
    const f = await s.readFeedback();
    expect(f.undos).toHaveLength(2);
    expect(f.undos[0]).toMatchObject({ pass: 'HAL-001', status: 'done', commit: 'abc' });
    expect(f.undos[0]!.error).toBeUndefined();
    expect((await s.pendingUndos()).map((u) => u.pass)).toEqual(['HAL-002']);
    await s.recordUndo({ pass: 'HAL-002', run: 'r2', reason: 'meh', status: 'rejected', error: 'no such pass' });
    expect(await s.pendingUndos()).toEqual([]);
  });
  it('sync spend: save then load round-trips, keeps 60 days', async () => {
    const now = new Date(2026, 10, 12, 3);
    const s = createStore({ halDir: await mkdtemp(join(tmpdir(), 'hal-store-t7-')), now: () => now });
    const day = s.loadSpendTodaySync();
    expect(day.calls).toEqual([]);
    s.saveSpendDaySync({ ...day, calls: [{ run: 'r', role: 'planner', billing: 'api', usd: 1.5, at: now.toISOString() }] });
    expect(s.loadSpendTodaySync().calls).toHaveLength(1);
    expect((await s.loadSpendToday()).calls).toHaveLength(1);
  });
});
