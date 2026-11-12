import { describe, expect, it } from 'vitest';
import type { HistoryEntry, HistoryNight } from '@studio/core/hal';
import { renderHistory } from './history-page.js';

const hal = (o: Partial<Extract<HistoryEntry, { type: 'hal' }>> = {}): HistoryEntry => ({
  type: 'hal', sha: 'a'.repeat(40), pass: 'HAL-001', game: 'hyperline', kind: 'tuning', title: 'Slower first lap', why: 'Too fast to read',
  version: '1.0.1', run: 'r1', night: '2026-11-10', scoreBefore: 60, scoreAfter: 64.5, status: { kind: 'kept' }, shots: {}, ...o,
});
const brian = (o: Partial<Extract<HistoryEntry, { type: 'brian' }>> = {}): HistoryEntry => ({
  type: 'brian', sha: 'b'.repeat(40), night: '2026-11-10', title: 'tweak colors', author: 'Brian', date: '2026-11-10T20:00:00Z', ...o,
});
const nights: HistoryNight[] = [
  { night: '2026-11-11', entries: [hal({ pass: 'HAL-002', night: '2026-11-11', title: 'Bigger jump', status: { kind: 'undone', by: 'hal', reason: 'felt floaty', commit: 'c', version: '1.0.3' } }), brian()] },
  { night: '2026-11-10', entries: [hal()] },
];
const base = { game: 'hyperline', title: 'Hyperline', nights, notes: {} as Record<string, string>, scores: [], filter: {} };

describe('renderHistory', () => {
  it('has no no-referrer meta (the server header sets same-origin)', () => {
    const html = renderHistory(base);
    expect(html).not.toContain('no-referrer');
    expect(html).not.toMatch(/<meta name="referrer"(?![^>]*content="same-origin")/);
  });
  it('renders nights newest first with the note above entries', () => {
    const html = renderHistory({ ...base, notes: { '2026-11-11': '# hyperline, night of x\n\nA **good** night.' } });
    expect(html.indexOf('2026-11-11')).toBeLessThan(html.indexOf('2026-11-10'));
    expect(html.indexOf('<strong>good</strong>')).toBeLessThan(html.indexOf('Bigger jump'));
    expect(html).toContain('Hyperline');
    expect(html).toContain('href="/"');
  });
  it('collapses notes after the first 3 nights', () => {
    const four = ['11', '10', '09', '08'].map((d) => ({ night: `2026-11-${d}`, entries: [hal({ pass: `HAL-0${d}` })] }));
    const html = renderHistory({ ...base, nights: four, notes: Object.fromEntries(four.map((n) => [n.night, 'note text'])) });
    expect(html.match(/<details class="fold note-fold"( open)?>/g)).toHaveLength(1);
    expect(html.split('note text').length - 1).toBe(4);
  });
  it('status texts', () => {
    const html = renderHistory({ ...base, nights: [{ night: 'n', entries: [hal(), hal({ pass: 'HAL-003', status: { kind: 'reverted', commit: 'c', date: 'd' } }), nights[0]!.entries[0]!] }] });
    expect(html).toContain('Kept');
    expect(html).toContain('Undone: felt floaty');
    expect(html).toContain('Reverted later (by you)');
    expect(html).toContain('60.0'); // score change shown
    expect(html).toContain('64.5');
    expect(html).toContain('v1.0.1');
  });
  it('Brian entries say Yours', () => {
    expect(renderHistory(base)).toMatch(/Yours[\s\S]*tweak colors/);
  });
  it('permalink ids', () => {
    const html = renderHistory(base);
    expect(html).toContain('id="HAL-001"');
    expect(html).toContain('href="#HAL-001"');
  });
  it('shows before/after images through the img route', () => {
    const e = hal({ shots: { before: 'docs/hal/history/hyperline/2026-11-10/HAL-001-before.jpg', after: 'docs/hal/history/hyperline/2026-11-10/HAL-001-after.jpg' } });
    const html = renderHistory({ ...base, nights: [{ night: '2026-11-10', entries: [e] }] });
    expect(html).toContain('src="/_history/hyperline/img/2026-11-10/HAL-001-before.jpg"');
    expect(html).toContain('src="/_history/hyperline/img/2026-11-10/HAL-001-after.jpg"');
  });
  it('focus shows one entry with a link to the full page', () => {
    const html = renderHistory({ ...base, focus: 'HAL-002' });
    expect(html).toContain('Bigger jump');
    expect(html).not.toContain('Slower first lap');
    expect(html).not.toContain('tweak colors');
    expect(html).toContain('href="/_history/hyperline"');
  });
  it('filter form keeps its values', () => {
    const html = renderHistory({ ...base, filter: { q: 'jump "x"', kind: 'fix', status: 'undone' } });
    expect(html).toMatch(/<form [^>]*method="get"/);
    expect(html).toContain('name="q" value="jump &quot;x&quot;"');
    expect(html).toMatch(/<option value="fix" selected>/);
    expect(html).toMatch(/<option value="undone" selected>/);
  });
  it('svg line per measure; fewer than 2 nights shows the placeholder', () => {
    const run = (night: string, a: number, b: number) => ({ night, run: 'r', scorers: { s: { fitness: 50, measures: { speed: a, clarity: b } } } });
    const one = renderHistory({ ...base, scores: [run('2026-11-10', 50, 60)] });
    expect(one).toContain('Scores over time appear after two nights');
    expect(one).not.toContain('<polyline');
    const two = renderHistory({ ...base, scores: [run('2026-11-10', 50, 60), run('2026-11-11', 55, 70)] });
    expect(two.match(/<polyline/g)).toHaveLength(2);
    expect(two).toContain('speed');
    expect(two).toContain('clarity');
  });
  it('escapes commit subjects and notes', () => {
    const html = renderHistory({
      ...base, notes: { '2026-11-11': '<script>alert(1)</script> **b**' },
      nights: [{ night: '2026-11-11', entries: [hal({ title: '<img src=x onerror=1>', why: '"><b>' }), brian({ title: '<i>x</i>' })] }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<i>x');
    expect(html).toContain('&lt;img src=x');
  });
  it('no <script, no external URLs', () => {
    const html = renderHistory({ ...base, notes: { '2026-11-11': 'hi' } });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\son\w+=/);
  });
  it('empty result says so', () => {
    expect(renderHistory({ ...base, nights: [] })).toContain('Nothing here yet');
  });
});
