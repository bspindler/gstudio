import { describe, expect, it } from 'vitest';
import { MAX_TICKETS, splitLiability, validateTickets, type Ticket } from '../src/hal/tickets.js';

const games = ['tidepool-pals', 'gearhold'];
const measures = { 'tidepool-pals': ['inBand', 'noWalls'], gearhold: ['safeStarts'] };
const t = (o: Partial<Ticket> = {}): Ticket => ({ id: 'T1', game: 'tidepool-pals', kind: 'tuning', title: 'Soften level 7', why: 'win rate falls off a cliff', ...o });
const v = (tickets: unknown[]) => validateTickets({ tickets }, games, measures);

describe('validateTickets', () => {
  it('accepts a good ticket, from an object or a JSON string', () => {
    expect(v([t({ target: 'noWalls' })])).toEqual({ ok: true, tickets: [t({ target: 'noWalls' })] });
    expect(validateTickets(JSON.stringify({ tickets: [t()] }), games, measures).ok).toBe(true);
  });
  it('rejects non-JSON and a wrong shape', () => {
    expect(validateTickets('nope', games, measures).ok).toBe(false);
    expect(validateTickets({ tickets: 'x' }, games, measures).ok).toBe(false);
    expect(validateTickets([], games, measures).ok).toBe(false);
  });
  it('rejects unknown games and unknown measures', () => {
    expect(v([t({ game: 'pong' })])).toMatchObject({ ok: false, errors: [expect.stringContaining('unknown game')] });
    expect(v([t({ target: 'fun' })])).toMatchObject({ ok: false, errors: [expect.stringContaining('unknown measure')] });
    expect(v([t({ game: 'gearhold', target: 'inBand' })]).ok).toBe(false);
  });
  it('rejects bad kinds, long titles, empty why and duplicate ids', () => {
    expect(v([t({ kind: 'rewrite' as never })]).ok).toBe(false);
    expect(v([t({ title: 'x'.repeat(81) })]).ok).toBe(false);
    expect(v([t({ title: 'x'.repeat(80) })]).ok).toBe(true);
    expect(v([t({ why: ' ' })]).ok).toBe(false);
    expect(v([t(), t({ title: 'Other' })]).ok).toBe(false);
  });
  it('rejects more than 8 tickets', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => t({ id: `T${i}`, title: `Idea ${i}` }));
    expect(v(many(MAX_TICKETS)).ok).toBe(true);
    expect(v(many(MAX_TICKETS + 1))).toMatchObject({ ok: false, errors: [expect.stringContaining('more than 8')] });
  });
  it('rejects duplicate titles, ignoring case and spacing', () => {
    expect(v([t(), t({ id: 'T2', title: '  soften LEVEL 7 ' })])).toMatchObject({ ok: false, errors: [expect.stringContaining('duplicate title')] });
  });
  it('rejects a ticket that edits a protected area by its own description', () => {
    for (const title of ['Edit the score for gearhold', 'Loosen the tripwire', 'Update policy.yaml limits', 'Change scripts/hal/cli.ts', 'Tweak the scoring weights', 'Edit CLAUDE.md rules']) {
      expect(v([t({ title })]), title).toMatchObject({ ok: false, errors: [expect.stringContaining('protected')] });
    }
    expect(v([t({ why: 'Relax the compliance check so it passes' })]).ok).toBe(false);
  });
  it('does not reject a ticket that merely talks about the score', () => {
    expect(v([t({ title: 'Raise tidepool inBand by easing level 7', why: 'the score is low because level 7 is a wall' })]).ok).toBe(true);
  });
  it('requires a liability field when the ticket adds a dependency or host', () => {
    expect(v([t({ title: 'Add a CDN script for particles' })]).ok).toBe(false);
    expect(v([t({ title: 'Add a CDN script for particles', liability: 'CDN script: cdn.example.com/p.js' })]).ok).toBe(true);
  });
});

describe('splitLiability', () => {
  const lib = t({ id: 'L', title: 'Use a font host', liability: 'font host fonts.example.com' });
  const plain = t({ id: 'P', title: 'Plain' });
  it('passes non-liability tickets through and turns unapproved ones into calls', () => {
    expect(splitLiability([plain, lib], [])).toEqual({ build: [plain], calls: [lib] });
  });
  it('builds approved ones and keeps their liability field', () => {
    const r = splitLiability([plain, lib], [{ item: ' Font Host fonts.example.com', at: 'x', by: 'brian' }]);
    expect(r.calls).toEqual([]);
    expect(r.build).toEqual([plain, lib]);
    expect(r.build[1]!.liability).toBe('font host fonts.example.com');
  });
  it('an approval for something else does not count', () => {
    expect(splitLiability([lib], [{ item: 'something else', at: 'x', by: 'brian' }]).calls).toEqual([lib]);
  });
});
