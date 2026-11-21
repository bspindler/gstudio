import { describe, expect, it } from 'vitest';
import { MAX_TICKETS, splitLiability, validateTickets, type Ticket } from '../src/hal/tickets.js';

const games = ['tidepool-pals', 'gearhold'];
const measures = { 'tidepool-pals': ['inBand', 'noWalls'], gearhold: ['safeStarts'] };
const t = (o: Partial<Ticket> = {}): Ticket => ({ id: 'T1', game: 'tidepool-pals', kind: 'tuning', title: 'Soften level 7', why: 'win rate falls off a cliff', ...o });
const v = (tickets: unknown[]) => validateTickets({ tickets }, games, measures);

/** The reasons the single ticket in a one-ticket batch was rejected (none = kept). */
const why = (tickets: unknown[]) => {
  const r = v(tickets);
  if (!r.ok) throw new Error(`batch rejected: ${r.errors.join('; ')}`);
  return r.rejected.flatMap((x) => x.reasons);
};
const kept = (tickets: unknown[]) => { const r = v(tickets); return r.ok ? r.tickets.map((x) => x.id) : null; };

describe('validateTickets', () => {
  it('accepts a good ticket, from an object or a JSON string', () => {
    expect(v([t({ target: 'noWalls' })])).toEqual({ ok: true, tickets: [t({ target: 'noWalls' })], rejected: [] });
    expect(validateTickets(JSON.stringify({ tickets: [t()] }), games, measures).ok).toBe(true);
  });
  it('batch problems are fatal: non-JSON, a wrong shape, more than 8 tickets', () => {
    expect(validateTickets('nope', games, measures).ok).toBe(false);
    expect(validateTickets({ tickets: 'x' }, games, measures).ok).toBe(false);
    expect(validateTickets([], games, measures).ok).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => t({ id: `T${i}`, title: `Idea ${i}` }));
    expect(kept(many(MAX_TICKETS))).toHaveLength(MAX_TICKETS);
    expect(v(many(MAX_TICKETS + 1))).toMatchObject({ ok: false, errors: [expect.stringContaining('more than 8')] });
  });
  it('one bad ticket is rejected on its own with its reason; the good ones are kept', () => {
    const r = v([t({ id: 'A', title: 'Good one' }), t({ id: 'B', title: 'Bad game', game: 'pong' }), 'junk', t({ id: 'C', title: 'Good two' })]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.tickets.map((x) => x.id)).toEqual(['A', 'C']);
    expect(r.rejected).toEqual([
      { index: 2, id: 'B', title: 'Bad game', reasons: ['unknown game pong'] },
      { index: 3, reasons: ['not an object'] },
    ]);
  });
  it('rejects unknown games and unknown measures', () => {
    expect(why([t({ game: 'pong' })])).toEqual([expect.stringContaining('unknown game')]);
    expect(why([t({ target: 'fun' })])).toEqual([expect.stringContaining('unknown measure')]);
    expect(why([t({ game: 'gearhold', target: 'inBand' })])).toHaveLength(1);
  });
  it('shortens a long title at a word instead of throwing the ticket away', () => {
    const long = 'Hyperline sector-clear banner: the sector name flashes in neon with a synth chord as you cross';
    const r = v([t({ title: long })]);
    expect(r.ok && r.rejected).toEqual([]);
    const title = r.ok ? r.tickets[0]!.title : '';
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
    expect(long.startsWith(title.slice(0, -1).trimEnd())).toBe(true);
  });
  it('rejects bad kinds, empty why; a duplicate id rejects only the later ticket', () => {
    expect(why([t({ kind: 'rewrite' as never })])).toHaveLength(1);
    expect(why([t({ title: 'x'.repeat(80) })])).toEqual([]);
    expect(why([t({ why: ' ' })])).toHaveLength(1);
    expect(kept([t(), t({ title: 'Other' })])).toEqual(['T1']);
    expect(why([t(), t({ title: 'Other' })])).toEqual(['duplicate id T1']);
  });
  it('rejects duplicate titles, ignoring case and spacing (the first stays)', () => {
    expect(kept([t(), t({ id: 'T2', title: '  soften LEVEL 7 ' })])).toEqual(['T1']);
    expect(why([t(), t({ id: 'T2', title: '  soften LEVEL 7 ' })])).toEqual([expect.stringContaining('duplicate title')]);
  });
  it('rejects a ticket that edits a protected area by its own description', () => {
    for (const title of ['Edit the score for gearhold', 'Loosen the tripwire', 'Update policy.yaml limits', 'Change scripts/hal/cli.ts', 'Tweak the scoring weights', 'Edit CLAUDE.md rules', "Relax Hal's gate for tidepool", 'Skip the keep gate', 'Update the ledger']) {
      expect(why([t({ title })]), title).toEqual([expect.stringContaining('protected')]);
    }
    expect(why([t({ why: 'Relax the compliance check so it passes' })])).toHaveLength(1);
  });
  it('the hal hook: editing it is protected, saying the ticket leaves it alone is not', () => {
    // HAL-130's weathervane, re-planned on 2026-11-15, was rejected twice for "touches no hal hook" wording.
    for (const w of ['Game code only (tapZones next to tapAt), no hal hook change.', 'Without touching the hal hook.', "Don't touch the hal hook; keep it calm.", 'Leaves the hal hook alone', 'never edits the hal hook', 'The hal hook stays untouched.']) {
      expect(why([t({ title: 'Block Barn: tap the roof weathervane, it spins slowly', why: w })]), w).toEqual([]);
    }
    for (const w of ['Add the vane to the hal hook targets.', 'Edit the hal hook so the robot sees the vane', 'Without the vane, change the hal hook.']) {
      expect(why([t({ title: 'Block Barn: weathervane', why: w })]), w).toEqual([expect.stringContaining('protected')]);
    }
  });
  it('rejects a ticket naming Block Barn\'s recorder or audio', () => {
    expect(why([t({ why: 'Rework block-barn/recorder.js to buffer longer' })])).toEqual([expect.stringContaining('protected')]);
    expect(why([t({ why: 'Replace the files in block-barn/audio with new takes' })])).toEqual([expect.stringContaining('protected')]);
    expect(why([t({ title: 'Make animals bounce', why: 'toddlers like it' })])).toEqual([]);
  });
  it('near misses: ordinary polish wording is not protected', () => {
    for (const [title, w] of [
      ['Fix touch targets so the score panel is readable', 'small phones miss the buttons'],
      ['Update the score panel font size', 'hard to read on a phone'],
      ['Tweak the gate timing in level 3', 'the Gearhold gate closes before the robot reaches it'],
      ['Change gate colours in Gearhold', 'gates are hard to see'],
      ['Raise tidepool inBand by easing level 7', 'the score is low because level 7 is a wall'],
    ] as const) {
      expect(why([t({ title, why: w })]), title).toEqual([]);
    }
  });
  it('requires a liability field when the ticket adds a dependency, host or real money', () => {
    for (const title of ['Add a CDN script for particles', 'Sell coin packs for $0.99', 'Price the skin at €2', 'Add a real money tip jar', 'Add an IAP for hints', 'Offer a purchase of extra lives', 'Add a monthly subscription', 'Show ads between levels', 'Add analytics on level fails', 'Load sprites from a URL', 'Edit package.json scripts', 'Fetch https://example.com/levels']) {
      expect(why([t({ title })]), title).toEqual([expect.stringContaining('liability')]);
    }
    expect(why([t({ title: 'Add a CDN script for particles', liability: 'CDN script: cdn.example.com/p.js' })])).toEqual([]);
  });
  it('near misses: the game\'s own address is not a new host', () => {
    // 2026-11-16: all five tickets were rejected two nights running for "url" (Block Barn zoom guard, ?level= starts).
    for (const [title, w] of [
      ['Block Barn: stop iPhone double-tap and pinch zoom on the whole page', 'Brian saw it on the Pages url on an iPhone: touch-action: manipulation plus a gesturestart guard'],
      ['Tidepool: open any level from the URL (?level=24) for testing', 'read the level from the page URL query string so Brian can jump to level 24'],
      ['Gearhold: start any level from the URL (?level=4) for testing', 'URLSearchParams on location.search, no network'],
      ['Hyperline: start any sector from the URL (?sector=9) for testing', 'a ?sector= link'],
    ] as const) {
      expect(why([t({ title, why: w })]), title).toEqual([]);
    }
    for (const title of ['Load sprites from a URL', 'Fetch the level list from a remote URL', 'Send scores to an API URL']) {
      expect(why([t({ title })]), title).toEqual([expect.stringContaining('liability')]);
    }
  });
  it('a liability rejection names the words that tripped it', () => {
    expect(why([t({ title: 'Add a CDN script for particles' })])).toEqual([expect.stringContaining('"CDN"')]);
  });
  it('near misses: in-game coin prices are not money', () => {
    for (const [title, w] of [
      ['Lower shop prices in coins', 'Hyperline players cannot afford the second trail'],
      ['Rebalance the coin shop', 'skin prices in coins are too steep for new players'],
      ['Show the price of each skin in coins', 'players do not know what they can afford'],
    ] as const) {
      expect(why([t({ title, why: w })]), title).toEqual([]);
    }
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

describe('rebuildOf: a feature Brian approved that no longer applied', () => {
  it('is a pass id on a feature ticket', () => {
    expect(why([t({ kind: 'feature', rebuildOf: 'HAL-276' })])).toEqual([]);
    expect(why([t({ kind: 'feature', rebuildOf: 'level 4' })])).toEqual([expect.stringContaining('rebuildOf')]);
    expect(why([t({ kind: 'tuning', rebuildOf: 'HAL-276' })])).toEqual([expect.stringContaining('rebuildOf')]);
  });
});
