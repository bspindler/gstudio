import { describe, expect, it } from 'vitest';
import { buildHistory, filterHistory, type CommitRecord } from '../src/hal/history.js';
import { formatTrailers, type HalTrailers } from '../src/hal/release.js';

const TZ = -360;
const sha = (n: number) => String(n).padStart(40, 'a');
const trailers = (o: Partial<HalTrailers> = {}): HalTrailers => ({
  pass: 'HAL-001', game: 'gearhold', kind: 'tuning', why: 'runs felt flat', scoreBefore: 60, scoreAfter: 64, version: '1.0.1', run: 'run-2026-11-10T08-00-00-000Z', ...o,
});
const change = (n: number, date: string, o: Partial<HalTrailers> = {}, title = 'steeper curve'): CommitRecord => {
  const t = trailers(o);
  return { sha: sha(n), author: 'Hal', date, message: `${t.kind}(${t.game}): ${title}\n\nBody text.\n\n${formatTrailers(t)}\n` };
};

describe('buildHistory', () => {
  it('hal change is an entry with its trailers, title from the subject after "<kind>(<game>): ", status kept', () => {
    const h = buildHistory('gearhold', [change(1, '2026-11-10T14:00:00Z')], [], TZ);
    expect(h).toEqual([{ night: '2026-11-10', entries: [{
      type: 'hal', sha: sha(1), pass: 'HAL-001', game: 'gearhold', kind: 'tuning', title: 'steeper curve', why: 'runs felt flat',
      version: '1.0.1', run: 'run-2026-11-10T08-00-00-000Z', night: '2026-11-10', scoreBefore: 60, scoreAfter: 64, status: { kind: 'kept' }, shots: {},
    }] }]);
  });

  it('a Hal-Undo commit marks its pass undone with Hal-Reason and the undo\'s Hal-Version, and is not itself an entry', () => {
    const t = trailers({ pass: 'HAL-002', undo: 'HAL-001', reason: 'too hard', version: '1.0.2', run: 'undo-2026-11-11T08-00-00-000Z' });
    const undo: CommitRecord = { sha: sha(2), author: 'Hal', date: '2026-11-11T14:00:00Z', message: `revert(gearhold): undo steeper curve\n\nBody.\n\n${formatTrailers(t)}\n` };
    const h = buildHistory('gearhold', [undo, change(1, '2026-11-10T14:00:00Z')], [], TZ);
    expect(h).toHaveLength(1);
    expect(h[0]!.entries).toHaveLength(1);
    expect(h[0]!.entries[0]).toMatchObject({ pass: 'HAL-001', status: { kind: 'undone', by: 'hal', reason: 'too hard', commit: sha(2), version: '1.0.2' } });
  });

  it('"This reverts commit <sha>" in a commit body marks that Hal change reverted (date of the revert), and the revert shows as a brian entry', () => {
    const rev = (n: number, ref: string): CommitRecord => ({ sha: sha(n), author: 'Brian', date: '2026-11-12T15:00:00Z', message: `Revert "tuning(gearhold): steeper curve"\n\nThis reverts commit ${ref}.\n` });
    for (const ref of [sha(1), sha(1).slice(0, 7)]) {
      const h = buildHistory('gearhold', [rev(3, ref), change(1, '2026-11-10T14:00:00Z')], [], TZ);
      expect(h[0]!.entries[0]).toMatchObject({ type: 'brian', sha: sha(3), author: 'Brian', title: 'Revert "tuning(gearhold): steeper curve"' });
      expect(h[1]!.entries[0]).toMatchObject({ type: 'hal', status: { kind: 'reverted', commit: sha(3), date: '2026-11-12T15:00:00Z' } });
    }
  });

  it('"docs(hal): director\'s note" commits (Hal-Run trailer, no Hal-Pass) are never entries', () => {
    const note: CommitRecord = { sha: sha(4), author: 'Hal', date: '2026-11-11T09:00:00Z', message: "docs(hal): director's note, night of 2026-11-10\n\nNote body.\n\nHal-Run: run-2026-11-10T08-00-00-000Z\n" };
    expect(buildHistory('gearhold', [note], [], TZ)).toEqual([]);
  });

  it('a commit with no Hal trailers is a brian entry, title = subject', () => {
    const c: CommitRecord = { sha: sha(5), author: 'Brian', date: '2026-11-10T20:00:00Z', message: 'feat(gearhold): new boss\n\nDetails.\n' };
    expect(buildHistory('gearhold', [c], [], TZ)).toEqual([{ night: '2026-11-10', entries: [{ type: 'brian', sha: sha(5), night: '2026-11-10', title: 'feat(gearhold): new boss', author: 'Brian', date: '2026-11-10T20:00:00Z' }] }]);
  });

  it('entries for another game (Hal-Game) are dropped', () => {
    const h = buildHistory('gearhold', [change(1, '2026-11-10T14:00:00Z', { game: 'tidepool' }), change(2, '2026-11-10T09:00:00Z', { pass: 'HAL-002' })], [], TZ);
    expect(h[0]!.entries.map((e) => e.sha)).toEqual([sha(2)]);
  });

  it('nights newest first, entries in a night newest first; night of a hal entry = nightOf(commit date, tz)', () => {
    const cs = [
      change(1, '2026-11-09T14:00:00Z', { pass: 'HAL-001' }),
      change(2, '2026-11-10T16:00:00Z', { pass: 'HAL-002' }),
      change(3, '2026-11-10T18:00:00Z', { pass: 'HAL-003' }),
      // 02:00 UTC on the 11th is 20:00 local on the 10th (tz -360): same night as the 10th
      change(4, '2026-11-11T02:00:00Z', { pass: 'HAL-004' }),
    ];
    const h = buildHistory('gearhold', cs, [], TZ);
    expect(h.map((n) => n.night)).toEqual(['2026-11-10', '2026-11-09']);
    expect(h[0]!.entries.map((e) => e.sha)).toEqual([sha(4), sha(3), sha(2)]);
    expect(h[1]!.entries.map((e) => e.sha)).toEqual([sha(1)]);
  });

  it('shots attached only when the file is in files', () => {
    const base = 'docs/hal/history/gearhold/2026-11-10/HAL-001';
    const c = [change(1, '2026-11-10T14:00:00Z')];
    expect((buildHistory('gearhold', c, [`${base}-before.jpg`], TZ)[0]!.entries[0] as { shots: unknown }).shots).toEqual({ before: `${base}-before.jpg` });
    expect((buildHistory('gearhold', c, [`${base}-before.jpg`, `${base}-after.jpg`], TZ)[0]!.entries[0] as { shots: unknown }).shots).toEqual({ before: `${base}-before.jpg`, after: `${base}-after.jpg` });
    expect((buildHistory('gearhold', c, [], TZ)[0]!.entries[0] as { shots: unknown }).shots).toEqual({});
  });
});

describe('filterHistory', () => {
  const t2 = trailers({ pass: 'HAL-002', undo: 'HAL-001', reason: 'x', version: '1.0.2', run: 'undo-2026-11-11T08-00-00-000Z' });
  const commits: CommitRecord[] = [
    change(1, '2026-11-09T14:00:00Z', { pass: 'HAL-001', kind: 'tuning', why: 'Flat Runs' }, 'steeper curve'),
    { sha: sha(2), author: 'Hal', date: '2026-11-09T15:00:00Z', message: `revert(gearhold): undo steeper curve\n\n${formatTrailers(t2)}\n` },
    change(3, '2026-11-10T14:00:00Z', { pass: 'HAL-003', kind: 'fix', why: 'crash on boss' }, 'Boss crash'),
    change(5, '2026-11-11T14:00:00Z', { pass: 'HAL-005', kind: 'polish', why: 'prettier' }, 'glow'),
    { sha: sha(6), author: 'Brian', date: '2026-11-11T20:00:00Z', message: `Revert "polish(gearhold): glow"\n\nThis reverts commit ${sha(5)}.\n` },
  ];
  const nights = buildHistory('gearhold', commits, [], TZ);
  const shas = (n: ReturnType<typeof buildHistory>) => n.flatMap((x) => x.entries.map((e) => e.sha));

  it('q matches title/why/pass case-insensitively', () => {
    expect(shas(filterHistory(nights, { q: 'FLAT' }))).toEqual([sha(1)]);
    expect(shas(filterHistory(nights, { q: 'boss crash' }))).toEqual([sha(3)]);
    expect(shas(filterHistory(nights, { q: 'hal-003' }))).toEqual([sha(3)]);
  });
  it('kind filters by change kind, brian for manual commits', () => {
    expect(shas(filterHistory(nights, { kind: 'fix' }))).toEqual([sha(3)]);
    expect(shas(filterHistory(nights, { kind: 'brian' }))).toEqual([sha(6)]);
  });
  it('status undone includes reverted; kept excludes both', () => {
    expect(shas(filterHistory(nights, { status: 'undone' })).sort()).toEqual([sha(1), sha(5)].sort());
    expect(shas(filterHistory(nights, { status: 'kept' }))).toEqual([sha(3)]);
  });
  it('empty nights dropped', () => {
    const f = filterHistory(nights, { q: 'boss crash' });
    expect(f.map((n) => n.night)).toEqual(['2026-11-10']);
    expect(filterHistory(nights, { q: 'nomatch' })).toEqual([]);
  });
});
