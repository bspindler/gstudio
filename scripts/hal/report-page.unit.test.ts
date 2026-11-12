// The morning report page: pure HTML from a ReportView. No server, no files.
import { describe, expect, it } from 'vitest';
import type { Ticket } from '@studio/core/hal';
import type { CandidateResult } from './candidate.js';
import { esc } from './page-style.js';
import { renderReport, type ReportView } from './report-page.js';
import type { RunReport } from './run.js';

const RUN = 'run-2026-11-12T08-00-00-000Z';
const sr = (fitness: number) => ({ game: 'g', levels: [], measures: {}, fitness, hardFailures: [] });
const ticket = (id: string, game: string, kind: Ticket['kind'], title: string, extra: Partial<Ticket> = {}): Ticket =>
  ({ id, game, kind, title, why: `why ${title}`, ...extra });
const change = (pass: string, t: Ticket, verdict: CandidateResult['verdict'], extra: Partial<CandidateResult> = {}): CandidateResult => ({
  pass, ticket: t, verdict, reasons: [], scoresBefore: { [t.game]: sr(70) }, scoresAfter: { [t.game]: sr(80) }, costUsd: 0.5, ...extra,
});

type Report = RunReport & { perGame?: Record<string, string> };

function fullReport(): Report {
  return {
    runId: RUN, night: '2026-11-11', startedAt: '2026-11-12T08:00:00Z', endedAt: '2026-11-12T09:30:00Z',
    trigger: 'nightly', billing: 'api', billingEnded: 'api', spend: { api: 1.234, subscription: 0.5 },
    games: {
      gearhold: { before: { gearhold: 91.67, 'gearhold-play': 74.69 }, after: { gearhold: 91.67, 'gearhold-play': 82.95 }, measures: {} },
      'tidepool-pals': { before: { 'tidepool-pals': 100 }, after: { 'tidepool-pals': 100 }, measures: {} },
      hyperline: { before: { hyperline: 80 }, after: { hyperline: 70 }, measures: {} },
      'deep-dive': { before: { 'deep-dive': 60 }, after: { 'deep-dive': 60 }, measures: {} },
    },
    changes: [
      change('HAL-003', ticket('T1', 'gearhold', 'tuning', 'Kiln Heart is a fairer fight'), 'merged', {
        version: '0.2.1', summary: 'Kilnwarden hp 260 to 210.', changelog: 'Kiln Heart is fairer.',
        shots: { before: 'docs/hal/history/gearhold/2026-11-11/HAL-003-before.jpg', after: 'docs/hal/history/gearhold/2026-11-11/HAL-003-after.jpg' },
      }),
      change('HAL-004', ticket('T2', 'tidepool-pals', 'polish', 'Softer bubble pops'), 'merged', { version: '0.1.4', changelog: 'Bubbles pop softer.' }),
      change('HAL-005', ticket('T3', 'hyperline', 'fix', 'Pause button works after resume'), 'merged', { version: '0.3.2', changelog: 'Pause works again.' }),
      change('HAL-006', ticket('T4', 'hyperline', 'tuning', 'Faster lanes'), 'discarded', { reasons: ['fitness fell 80 -> 70'] }),
    ],
    calls: [ticket('T9', 'hyperline', 'feature', 'Add a leaderboard', { liability: 'network host api.leaders.test' })],
    planned: [],
    notes: [],
    pushed: true,
    warnings: ['push was slow'],
    perGame: { gearhold: 'Kiln Heart is now inside its band.' },
  };
}

function view(over: Partial<ReportView> = {}, report: Report = fullReport()): ReportView {
  return {
    report,
    note: 'One pass merged.\n\n**What changed:** Gearhold 0.2.1.\n\n**Next:**\n1. Fix the robot.\n2. Rerun it.',
    feedback: { votes: [], undos: [] },
    notes: [{ id: 'N-001', at: '2026-11-11T20:00:00Z', game: 'gearhold', text: 'Make the cannon louder', status: 'acted', reply: 'Done in HAL-004' }],
    approvals: [],
    status: { running: false },
    spendToday: 1.23, capUsd: 20,
    playUrl: 'http://10.0.0.5:5174/',
    games: ['gearhold', 'tidepool-pals', 'hyperline'],
    runs: [{ runId: RUN, endedAt: '2026-11-12T09:30:00Z' }, { runId: 'run-2026-11-11T08-00-00-000Z', endedAt: '2026-11-11T09:00:00Z' }],
    ...over,
  };
}

/** The HTML of the change card (an <article>) that holds `pass`. */
function card(html: string, pass: string): string {
  const cards = html.split('<article').slice(1).map((s) => s.slice(0, s.indexOf('</article>')));
  const c = cards.find((s) => s.includes(`value="${pass}"`) || s.includes(`pass=${pass}`));
  if (!c) throw new Error(`no card for ${pass}`);
  return c;
}
/** The forms (action + hidden fields) in `html`. */
function forms(html: string): Array<{ action: string; fields: Record<string, string>; body: string }> {
  return [...html.matchAll(/<form\b[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].map((m) => ({
    action: m[1]!,
    body: m[2]!,
    fields: Object.fromEntries([...m[2]!.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((f) => [f[1]!, f[2]!])),
  }));
}
/** The text of the section whose <h2> contains `title`, up to the next <section. */
function section(html: string, title: string): string {
  const h = html.search(new RegExp(`<h2[^>]*>[^<]*${title}`));
  if (h < 0) throw new Error(`no section ${title}`);
  const i = html.lastIndexOf('<section', h);
  const end = html.indexOf('<section', h);
  return html.slice(i, end < 0 ? undefined : end);
}

describe('renderReport', () => {
  it('has no referrer meta: no-referrer makes browsers send "Origin: null" on form POSTs, which the server 403s', () => {
    const html = renderReport(view());
    expect(html).not.toContain('no-referrer');
    expect(html).not.toMatch(/<meta name="referrer"(?![^>]*content="same-origin")/);
  });
  it('sections appear in order', () => {
    const r = fullReport();
    r.planned = [ticket('T7', 'gearhold', 'feature', 'A boss rush mode')];
    const html = renderReport(view({}, r));
    const order = ['Good morning. Here&#39;s what changed.', 'Director&#39;s note', 'Play', 'Where each game stands', 'Changes', 'Your calls',
      'Tell Hal', 'What got fixed (1)', 'Tried and dropped (1)', 'Planned, not built (1)', 'Warnings', 'Run Hal', 'Earlier reports'];
    const at = order.map((t) => html.indexOf(t));
    order.forEach((t, i) => expect(at[i], t).toBeGreaterThan(-1));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('Thursday, Nov 12 · overnight run');
    expect(html).toContain('3 merged · 1 tried and dropped · 1 need you');
    expect(html).toContain('— Hal · $1.23 API, $0.50 subscription');
  });

  it('a merged tuning change is a card with Keep and Undo forms carrying run and pass; a fix is in the collapsed list with Undo', () => {
    const html = renderReport(view());
    const c = card(html, 'HAL-003');
    expect(c).toContain('Kiln Heart is a fairer fight');
    expect(c).toContain('Kilnwarden hp 260 to 210.');
    expect(c).toContain('Kiln Heart is fairer.'); // the changelog line leads, the longer summary folds under it
    expect(c).toContain('0.2.1');
    expect(c).toMatch(/70(\.0)?\D+80(\.0)?/); // the score change
    const fs = forms(c);
    const keep = fs.find((f) => f.action === '/vote')!;
    const undo = fs.find((f) => f.action === '/undo')!;
    expect(keep.fields).toEqual({ run: RUN, pass: 'HAL-003' });
    expect(undo.fields).toEqual({ run: RUN, pass: 'HAL-003' });
    expect(keep.body).toMatch(/name="comment"/);
    expect(undo.body).toMatch(/name="reason"/);
    expect(card(html, 'HAL-004')).toContain('Bubbles pop softer.'); // no summary: the changelog line
    // the fix is not a card, it is in the collapsed list with its own Undo form
    expect(() => card(html, 'HAL-005')).toThrow();
    const fixed = section(html, 'What got fixed');
    expect(fixed).toMatch(/<details/);
    expect(fixed).toContain('Pause button works after resume');
    expect(forms(fixed).find((f) => f.action === '/undo')!.fields).toEqual({ run: RUN, pass: 'HAL-005' });
    // a discarded change has no card and no buttons
    expect(() => card(html, 'HAL-006')).toThrow();
    expect(forms(section(html, 'Tried and dropped'))).toEqual([]);
    expect(section(html, 'Tried and dropped')).toContain('fitness fell 80 -&gt; 70');
    // every form carries the run
    for (const f of forms(html)) expect(f.fields.run, f.action).toBe(RUN);
  });

  it('card shows Kept ✓ after an up vote, Undo queued / Undone in vX / Undo failed: e from undos', () => {
    const at = '2026-11-12T10:00:00Z';
    const html = renderReport(view({
      feedback: {
        votes: [{ run: RUN, item: 'HAL-003', vote: 'up', at }, { run: RUN, item: 'HAL-004', vote: 'down', at }],
        undos: [{ run: RUN, pass: 'HAL-004', reason: 'meh', at, status: 'pending' }],
      },
    }));
    const kept = card(html, 'HAL-003');
    expect(kept).toContain('Kept ✓');
    expect(kept).toMatch(/<details[^>]*><summary[^>]*>change<\/summary>[\s\S]*action="\/undo"/); // the forms move behind "change"
    expect(card(html, 'HAL-004')).toContain('Undo queued');
    expect(card(renderReport(view({ feedback: { votes: [], undos: [{ run: RUN, pass: 'HAL-004', reason: 'meh', at, status: 'done', version: '0.1.5' } as never] } })), 'HAL-004'))
      .toContain('Undone in v0.1.5');
    const failed = renderReport(view({ feedback: { votes: [], undos: [{ run: RUN, pass: 'HAL-004', reason: 'meh', at, status: 'failed', error: 'conflict <in> yaml' }] } }));
    expect(card(failed, 'HAL-004')).toContain('Undo failed: conflict &lt;in&gt; yaml');
    // no state: the buttons are shown directly, not behind "change"
    expect(card(renderReport(view()), 'HAL-003')).not.toMatch(/>change<\/summary>/);
    // the fix list shows its state too
    const fix = renderReport(view({ feedback: { votes: [], undos: [{ run: RUN, pass: 'HAL-005', reason: 'x', at, status: 'pending' }] } }));
    expect(section(fix, 'What got fixed')).toContain('Undo queued');
  });

  it('images only when shots exist; src is /shot?run=..&pass=..&which=before', () => {
    const html = renderReport(view());
    const c = card(html, 'HAL-003');
    expect(c).toContain(`src="/shot?run=${RUN}&amp;pass=HAL-003&amp;which=before"`);
    expect(c).toContain(`src="/shot?run=${RUN}&amp;pass=HAL-003&amp;which=after"`);
    expect(c).toContain('Before');
    expect(card(html, 'HAL-004')).not.toContain('<img');
  });

  it('a call has Approve and Leave it; an approved call says so', () => {
    const html = renderReport(view());
    const calls = section(html, 'Your calls');
    expect(calls).toContain('Add a leaderboard');
    expect(calls).toContain('network host api.leaders.test');
    const fs = forms(calls);
    expect(fs.find((f) => f.action === '/approve')!.fields).toEqual({ run: RUN, item: 'network host api.leaders.test' });
    expect(fs.find((f) => f.action === '/decline')!.fields).toEqual({ run: RUN, item: 'network host api.leaders.test' });
    expect(calls).toContain('Approve');
    expect(calls).toContain('Leave it');
    const approved = section(renderReport(view({ approvals: ['network host api.leaders.test'] })), 'Your calls');
    expect(approved).toContain('Approved; Hal builds it next run');
    expect(forms(approved).find((f) => f.action === '/approve')).toBeUndefined();
    // approving it removes it from "need you"
    expect(renderReport(view({ approvals: ['network host api.leaders.test'] }))).toContain('0 need you');
  });

  it('Tell Hal lists open notes with status and reply and a Clear form per note', () => {
    const html = renderReport(view({
      notes: [
        { id: 'N-001', at: '2026-11-11T20:00:00Z', game: 'gearhold', text: 'Make the cannon louder', status: 'acted', reply: 'Done in HAL-004' },
        { id: 'N-002', at: '2026-11-11T21:00:00Z', game: null, text: 'Less purple', status: 'open' },
      ],
    }));
    const tell = section(html, 'Tell Hal');
    const fs = forms(tell);
    const send = fs.find((f) => f.action === '/tell')!;
    expect(send.body).toMatch(/<select name="game"/);
    expect(send.body).toContain('<option value="">The whole studio</option>');
    expect(send.body).toContain('<option value="hyperline">');
    expect(send.body).toMatch(/<textarea name="text"/);
    expect(tell).toContain('Make the cannon louder');
    expect(tell).toContain('Done in HAL-004');
    expect(tell).toMatch(/acted/i);
    expect(tell).toContain('Less purple');
    expect(tell).toMatch(/open/i);
    expect(fs.filter((f) => f.action === '/notes/clear').map((f) => f.fields.id)).toEqual(['N-001', 'N-002']);
  });

  it('old report (no perGame, no planned) renders without those parts; report-only with only planned shows Planned, not built and "Nothing changed overnight."', () => {
    const old = fullReport() as Partial<Report>;
    delete old.perGame;
    delete old.planned;
    const html = renderReport(view({}, old as Report));
    expect(html).not.toContain('Planned, not built');
    expect(html).not.toContain('Kiln Heart is now inside its band.');
    expect(html).toContain('Where each game stands');

    const ro: Report = {
      ...fullReport(), trigger: 'manual', changes: [], calls: [], warnings: [], perGame: undefined,
      planned: [ticket('T1', 'gearhold', 'tuning', 'Tune Kiln Heart'), ticket('T2', 'hyperline', 'polish', 'Brighter lanes')],
    };
    const page = renderReport(view({ note: '' }, ro));
    expect(page).toContain('Nothing changed overnight.');
    expect(page).toContain('Wednesday, Nov 11 · manual run');
    expect(page).toContain('Planned, not built (2)');
    expect(page).toContain('Tune Kiln Heart');
    for (const gone of ['Changes</h2>', 'Your calls', 'What got fixed', 'Tried and dropped', 'Warnings', 'Director&#39;s note']) expect(page, gone).not.toContain(gone);
    expect(page).toContain('Where each game stands');
    expect(page).toContain('Tell Hal');
    expect(page).toContain('Run Hal');
  });

  it('game rows: badge and bar for the after fitness (min over scorers), why from perGame', () => {
    const html = section(renderReport(view()), 'Where each game stands');
    const row = (g: string) => { const i = html.indexOf(g); return html.slice(i, html.indexOf('</li>', i)); };
    expect(row('Gearhold')).toContain('Improving');
    expect(row('Gearhold')).toContain('width:82.95%');
    expect(row('Gearhold')).toContain('Kiln Heart is now inside its band.');
    expect(row('Tidepool Pals')).toContain('Healthy');
    expect(row('Hyperline')).toContain('Slipped');
    expect(row('Deep Dive')).toContain('Steady');
  });

  it('escapes <script> in a note, title, reason and director text; director **bold** becomes <strong>', () => {
    const r = fullReport();
    r.changes[0]!.ticket.title = '<script>alert(1)</script>title';
    r.changes[3]!.reasons = ['<script>reason</script>'];
    r.calls[0]!.liability = '<script>item</script>';
    r.perGame = { gearhold: '<script>pergame</script>' };
    r.warnings = ['<script>warn</script>'];
    const html = renderReport(view({
      note: '**What <b>changed</b>:** <script>director</script>\n\n- a **list** item\n- <img src=x onerror=1>',
      notes: [{ id: 'N-1"><script>', at: 'x', game: null, text: '<script>note</script>', status: 'asked', reply: '<script>reply</script>' }],
      flash: '<script>flash</script>',
    }, r));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>');
    for (const s of ['alert(1)', 'reason', 'item', 'pergame', 'warn', 'director', 'note', 'reply', 'flash']) expect(html).toContain(`&lt;script&gt;${s === 'alert(1)' ? 'alert(1)' : s}`);
    expect(html).toContain('<strong>What &lt;b&gt;changed&lt;/b&gt;:</strong>');
    expect(html).toMatch(/<ul>\s*<li>a <strong>list<\/strong> item<\/li>/);
  });

  it('no <script, no http(s):// URL other than playUrl, viewport meta present, no inline style width over 520px', () => {
    const html = renderReport(view());
    expect(html).not.toMatch(/<script/i);
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]*/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toBe('http://10.0.0.5:5174/');
    expect(html).toMatch(/<meta name="viewport" content="width=device-width,initial-scale=1[^"]*">/);
    expect(html).toMatch(/max-width:\s*520px/);
    for (const m of html.matchAll(/(?:^|[^-])(?:min-)?width:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(m[1]), m[0]).toBeLessThanOrEqual(520);
    expect(html).toContain('href="http://10.0.0.5:5174/"');
    // no play URL: the hint instead of a link
    const none = renderReport(view({ playUrl: null }));
    expect(none).not.toMatch(/https?:\/\//);
    expect(none).toContain('npm run dev:lan');
  });

  it('Run Hal keeps the status line, spend, Run now and Stop forms, and links the 10 newest earlier reports', () => {
    const runs = Array.from({ length: 12 }, (_, i) => ({ runId: `run-2026-11-${String(12 - i).padStart(2, '0')}T08-00-00-000Z`, endedAt: `2026-11-${String(12 - i).padStart(2, '0')}T09:00:00Z` }));
    const html = renderReport(view({ runs, status: { running: true, phase: 'scoring <x>', startedAt: '2026-11-12T08:00:00Z' }, spendToday: 3.5 }));
    const run = section(html, 'Run Hal');
    expect(run).toMatch(/Running: scoring &lt;x&gt; \(since Nov 12, \d{1,2}:00\s[AP]M\)/);
    expect(run).toContain('API spend today: $3.50 of $20.00');
    const fs = forms(run);
    const now = fs.find((f) => f.action === '/run')!;
    expect(now.body).toMatch(/<select name="game"/);
    expect(now.body).toContain('<option value="">All games</option>');
    expect(now.body).toMatch(/<input type="checkbox" name="reportOnly" value="1"/);
    expect(fs.find((f) => f.action === '/stop')).toBeDefined();
    const links = [...run.matchAll(/href="\/runs\/([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(runs.slice(0, 10).map((r) => r.runId));
    expect(section(renderReport(view()), 'Run Hal')).toContain('Idle');
  });

  it('times are in the given zone (default the local one), not UTC', () => {
    const runs = [{ runId: RUN, endedAt: '2026-11-12T09:30:00Z' }, { runId: 'run-b', endedAt: '2026-11-11T03:05:00Z' }];
    const status = { running: true, phase: 'scoring', startedAt: '2026-11-12T08:00:00Z' };
    const la = section(renderReport(view({ runs, status, timeZone: 'America/Los_Angeles' })), 'Run Hal');
    expect(la).toMatch(/since Nov 12, 12:00\sAM\)/);
    expect(la).toMatch(/>Nov 12, 1:30\sAM</);
    expect(la).toMatch(/>Nov 10, 7:05\sPM</); // the previous evening there
    expect(la).not.toContain('UTC');
    const tokyo = section(renderReport(view({ runs, status, timeZone: 'Asia/Tokyo' })), 'Run Hal');
    expect(tokyo).toMatch(/>Nov 12, 6:30\sPM</);
    // no zone given: the process's local zone, same as Intl's default
    const local = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date('2026-11-12T09:30:00Z'));
    expect(section(renderReport(view({ runs })), 'Run Hal')).toContain(`>${local}<`);
  });

  it('a merged change of any kind other than fix gets a card, so "N merged" never counts an unshown change', () => {
    const r = fullReport();
    r.changes.push(change('HAL-007', ticket('T5', 'gearhold', 'content' as Ticket['kind'], 'Two new levels'), 'merged', { version: '0.2.3' }));
    const html = renderReport(view({}, r));
    expect(html).toContain('4 merged');
    expect(card(html, 'HAL-007')).toContain('Two new levels');
  });

  it('stylesheet: every tap target is at least 44px tall and inputs use 16px text', () => {
    const html = renderReport(view());
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    const tap = /summary|button|\.btn|input|select|textarea|\.run-link|\.check\b/;
    for (const r of rules.filter((x) => tap.test(x.sel))) {
      for (const m of r.body.matchAll(/min-height:\s*(\d+)px/g)) expect(Number(m[1]), `${r.sel} {${r.body}}`).toBeGreaterThanOrEqual(44);
    }
    const minH = (sel: string) => {
      const hits = rules.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).flatMap((r) => [...r.body.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1])));
      expect(hits.length, sel).toBeGreaterThan(0);
      return Math.max(...hits);
    };
    for (const sel of ['details>summary', 'button', '.btn', 'input[type=text]', 'select', '.run-link', '.check']) expect(minH(sel), sel).toBeGreaterThanOrEqual(44);
    const inputs = rules.find((r) => r.sel.startsWith('input[type=text],select,textarea'))!;
    expect(inputs.body).toMatch(/font:\s*16px/);
    // every form control in the page is one of those styled kinds (no unstyled controls)
    for (const m of html.matchAll(/<input type="([a-z]+)"/g)) expect(['hidden', 'text', 'checkbox']).toContain(m[1]);
  });

  it('shows the flash line and never the token', () => {
    const html = renderReport(view({ flash: 'Undo started' }));
    expect(html).toContain('Undo started');
    expect(html).not.toMatch(/tok-|[?&]t=/);
  });

  it('esc escapes the five HTML characters', () => {
    expect(esc(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});
