// The morning report: one run's report.json, its note and the feedback on it, as a phone-first HTML page.
// Pure: data in, HTML string out. No JavaScript; every action is a same-origin form POST that carries the run id.
// Every user and Claude string goes through esc. Fields added by plan 3 (perGame, Vote.comment) are optional.
import type { Ticket } from '@studio/core/hal';
import type { CandidateResult } from './candidate.js';
import { esc, pageHead } from './page-style.js';
import type { RunReport } from './run.js';
import type { Note, Undo, Vote } from './store.js';

// perGame and Vote.comment land with Task 2; typed here as optional so this compiles before and after it.
type ViewReport = RunReport & { perGame?: Record<string, string> };
type ViewVote = Vote & { comment?: string };
/** `version` is the undo's new game version when the store has it. */
type ViewUndo = Undo & { version?: string };

export type ReportView = {
  report: ViewReport; note: string;
  feedback: { votes: ViewVote[]; undos: ViewUndo[] };   // this run's (store.feedbackFor)
  notes: Note[];                                          // all open notes, for Tell Hal
  approvals: string[];                                    // approved liability items
  status: { running: boolean; phase?: string; startedAt?: string };
  spendToday: number; capUsd: number;
  playUrl: string | null;
  games: string[];
  runs: Array<{ runId: string; endedAt: string }>;       // for the "Earlier reports" list, newest first
  flash?: string;                                         // one line after a POST ("Undo started", ...)
  /** IANA zone for the times shown; default the Mac's own zone (Brian reads the page in his). Injected by tests. */
  timeZone?: string;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const usd = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** `tidepool-pals` -> `Tidepool Pals`. */
const gameName = (slug: string) => slug.split('-').map(cap).join(' ');
const normItem = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const score = (n: number) => n.toFixed(1);
const hidden = (name: string, value: string) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
const gameOptions = (games: string[]) => games.map((g) => `<option value="${esc(g)}">${esc(gameName(g))}</option>`).join('');
const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null);

// ---- the director's note -------------------------------------------------------------------------------------------

const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/**
 * Paragraphs, `-`/`*` and `1.` lists, and `**bold**`; everything else is escaped text. The note's own title lines
 * (`# Hal, night of ...`, `## Director's note, ...`) at the top repeat the page header and are dropped; a heading
 * further down shows as a bold paragraph.
 */
export function noteHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && (!lines[0]!.trim() || /^#{1,6}\s/.test(lines[0]!.trim()))) lines.shift();
  const out: string[] = [];
  let kind: 'p' | 'ul' | 'ol' | null = null;
  let items: string[] = [];
  const flush = () => {
    if (kind === 'p') out.push(`<p>${items.join(' ')}</p>`);
    else if (kind) out.push(`<${kind}>${items.map((i) => `<li>${i}</li>`).join('')}</${kind}>`);
    kind = null;
    items = [];
  };
  const add = (k: 'p' | 'ul' | 'ol', html: string) => {
    if (kind !== k) flush();
    kind = k;
    items.push(html);
  };
  for (const raw of lines) {
    const t = raw.trim();
    let m: RegExpExecArray | null;
    if (!t) flush();
    else if ((m = /^[-*+]\s+(.*)$/.exec(t))) add('ul', inline(m[1]!));
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) add('ol', inline(m[1]!));
    else if ((m = /^#{1,6}\s+(.*)$/.exec(t))) { flush(); add('p', `<strong>${esc(m[1]!)}</strong>`); flush(); }
    else add('p', inline(t));
  }
  flush();
  return out.join('\n');
}

// ---- states --------------------------------------------------------------------------------------------------------

type State = { text: string; tone: 'good' | 'warn' | 'accent' };

/** The newest undo for the pass wins over votes (a Keep cannot cancel an undo); else the newest vote, if up. */
function changeState(pass: string, fb: ReportView['feedback']): State | null {
  const undo = fb.undos.filter((u) => u.pass === pass).at(-1);
  if (undo) {
    if (undo.status === 'done') return { text: undo.version ? `Undone in v${undo.version}` : 'Undone', tone: 'accent' };
    if (undo.status === 'failed' || undo.status === 'rejected') return { text: `Undo failed: ${clip(undo.error ?? 'unknown error', 300)}`, tone: 'warn' };
    return { text: 'Undo queued', tone: 'accent' };
  }
  const vote = fb.votes.filter((v) => v.item === pass).at(-1);
  return vote?.vote === 'up' ? { text: 'Kept ✓', tone: 'good' } : null;
}

const pill = (text: string, tone: State['tone'] | '' = '') => `<span class="pill${tone && tone !== 'accent' ? ` ${tone}` : ''}">${esc(text)}</span>`;

/** The state line with the forms behind "change", or the forms themselves when there is no state yet. */
const withState = (state: State | null, formsHtml: string) =>
  state
    ? `<div class="state">${pill(state.text, state.tone)}<details class="more"><summary class="small">change</summary><div class="more-body">${formsHtml}</div></details></div>`
    : formsHtml;

// ---- sections ------------------------------------------------------------------------------------------------------

function nightLabel(r: ViewReport): string {
  const d = new Date(`${r.night}T12:00:00Z`);
  const run = r.trigger === 'nightly' ? 'overnight run' : 'manual run';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.night) || Number.isNaN(d.getTime())) return `${r.night} · ${run}`;
  if (r.trigger === 'nightly') d.setUTCDate(d.getUTCDate() + 1); // read the morning after the night
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${run}`;
}

function header(v: ReportView, merged: number, dropped: number, needYou: number): string {
  const r = v.report;
  const h1 = merged ? "Good morning. Here's what changed." : 'Nothing changed overnight.';
  const spend = `${usd(r.spend.api)} API · ${usd(r.spend.subscription)} subscription${r.capReached ? ' · daily cap reached' : ''}`;
  return `<header class="hero">
<div class="label">${esc(nightLabel(r))}</div>
<h1>${esc(h1)}</h1>
<p class="tally">${merged} merged · ${dropped} tried and dropped · ${needYou} need you</p>
<p class="small muted">Spent ${esc(spend)}</p>
</header>`;
}

function director(v: ReportView): string {
  if (!v.note.trim()) return '';
  const r = v.report;
  return `<section><h2>${esc("Director's note")}</h2><div class="card note">
${noteHtml(v.note)}
<p class="sign">— Hal · ${usd(r.spend.api)} API, ${usd(r.spend.subscription)} subscription</p>
</div></section>`;
}

function play(v: ReportView): string {
  return v.playUrl
    ? `<section class="play"><a class="btn primary" href="${esc(v.playUrl)}">▶ Play</a></section>`
    : `<section class="play"><div class="card play-off"><span class="play-icon" aria-hidden="true">▶</span><div><strong>Play</strong><br><span class="small muted">Start <code>npm run dev:lan</code> on the Mac to play here</span></div></div></section>`;
}

function standings(v: ReportView): string {
  const r = v.report;
  const games = Object.keys(r.games);
  if (!games.length) return '';
  const rows = games.map((g) => {
    const s = r.games[g]!;
    const after = minOf(Object.values(s.after));
    const before = minOf(Object.values(s.before));
    const vals = Object.values(s.after);
    const badge: [string, State['tone']] =
      after !== null && before !== null && after > before ? ['Improving', 'good']
        : vals.length && vals.every((x) => x >= 100) ? ['Healthy', 'good']
          : after !== null && before !== null && after < before ? ['Slipped', 'warn']
            : ['Steady', 'accent'];
    const pct = Math.max(0, Math.min(100, Math.round((after ?? 0) * 100) / 100));
    const nums = after === null ? 'no score' : before !== null && before !== after ? `${score(before)} → ${score(after)}` : score(after);
    const why = r.perGame?.[g]?.trim();
    return `<li class="game">
<div class="game-top"><span class="game-name">${esc(gameName(g))}</span>${pill(badge[0], badge[1])}</div>
<div class="meter"><div class="bar ${badge[1]}"><span style="width:${pct}%"></span></div><span class="num small muted">${esc(nums)}</span></div>
${why ? `<p class="why small muted">${esc(clip(why, 600))}</p>` : ''}
</li>`;
  });
  return `<section><h2>Where each game stands</h2><div class="card"><ul class="rows">${rows.join('\n')}</ul></div></section>`;
}

/** Min fitness over the scorers, before and after the pass. */
function passScores(c: CandidateResult): { before: number | null; after: number | null } {
  return { before: minOf(Object.values(c.scoresBefore).map((s) => s.fitness)), after: minOf(Object.values(c.scoresAfter).map((s) => s.fitness)) };
}

function scoreLine(c: CandidateResult): string {
  const { before, after } = passScores(c);
  if (before === null || after === null) return '';
  const d = after - before;
  const tone = d > 0.05 ? 'good' : d < -0.05 ? 'warn' : '';
  return `<p class="score small"><span class="muted">Score</span> ${score(before)} → ${score(after)} <span class="delta ${tone}">${d >= 0 ? '+' : '−'}${score(Math.abs(d))}</span></p>`;
}

function changeCard(v: ReportView, c: CandidateResult): string {
  const run = v.report.runId;
  const t = c.ticket;
  // The changelog bullet is the plain-language line; the implementer's longer summary folds under it.
  const changelog = c.changelog?.trim() ?? '';
  const summary = c.summary?.trim() ?? '';
  const lead = changelog || summary;
  const more = changelog && summary && summary !== changelog ? summary : '';
  const shot = (which: 'before' | 'after') =>
    `<figure class="shot"><img src="${esc(`/shot?run=${encodeURIComponent(run)}&pass=${encodeURIComponent(c.pass)}&which=${which}`)}" alt="${esc(`${cap(which)}: ${t.title}`)}" loading="lazy"><figcaption class="tag">${cap(which)}</figcaption></figure>`;
  const forms = `<div class="grid2 votes">
<form method="post" action="/vote" class="stack">${hidden('run', run)}${hidden('pass', c.pass)}<input type="text" name="comment" maxlength="500" placeholder="Comment" aria-label="Comment on keeping ${esc(t.title)}"><button type="submit" class="good">👍 Keep</button></form>
<form method="post" action="/undo" class="stack">${hidden('run', run)}${hidden('pass', c.pass)}<input type="text" name="reason" maxlength="500" placeholder="Why? (optional)" aria-label="Reason to undo ${esc(t.title)}"><button type="submit" class="warn">👎 Undo</button></form>
</div>`;
  return `<article class="card change">
<div class="label">${esc(cap(t.kind))} · ${esc(gameName(t.game))}${c.version ? ` ${esc(c.version)}` : ''} · ${esc(c.pass)}</div>
<h3>${esc(t.title)}</h3>
${lead ? `<p class="lead">${esc(clip(lead, 700))}</p>` : ''}
${more ? `<details class="how"><summary class="small">How Hal did it</summary><p class="small muted">${esc(clip(more, 1500))}</p></details>` : ''}
${c.shots ? `<div class="grid2 shots">${shot('before')}${shot('after')}</div>` : ''}
${scoreLine(c)}
${withState(changeState(c.pass, v.feedback), forms)}
</article>`;
}

function changes(v: ReportView, cards: CandidateResult[]): string {
  if (!cards.length) return '';
  return `<section><h2>Changes</h2>${cards.map((c) => changeCard(v, c)).join('\n')}</section>`;
}

function calls(v: ReportView): string {
  const r = v.report;
  if (!r.calls.length) return '';
  const approved = new Set(v.approvals.map(normItem));
  const cards = r.calls.map((t: Ticket) => {
    const item = t.liability ?? '';
    const isApproved = approved.has(normItem(item));
    const declined = v.feedback.votes.filter((x) => x.item === item).at(-1)?.vote === 'down';
    const forms = `<div class="grid2">
<form method="post" action="/approve">${hidden('run', r.runId)}${hidden('item', item)}<button type="submit" class="primary">Approve</button></form>
<form method="post" action="/decline">${hidden('run', r.runId)}${hidden('item', item)}<button type="submit">Leave it</button></form>
</div>`;
    const action = isApproved
      ? `<div class="state">${pill('Approved; Hal builds it next run', 'good')}</div>`
      : withState(declined ? { text: 'Left it for now', tone: 'accent' } : null, forms);
    return `<div class="card call">
<div class="label">${esc(cap(t.kind))} · ${esc(gameName(t.game))}</div>
<h3>${esc(t.title)}</h3>
<p class="small muted">${esc(clip(t.why, 300))}</p>
<p class="ask small">Needs your OK for: <strong>${esc(item)}</strong></p>
${action}
</div>`;
  });
  return `<section><h2>Your calls</h2>${cards.join('\n')}</section>`;
}

const NOTE_STATUS: Record<string, [string, State['tone']]> = {
  open: ['Open', 'accent'], acted: ['Acted', 'good'], queued: ['Queued', 'accent'], asked: ['Hal asked', 'warn'],
};

function tell(v: ReportView): string {
  const run = v.report.runId;
  const opts = gameOptions(v.games);
  const notes = v.notes.map((n) => {
    const [label, tone] = NOTE_STATUS[n.status] ?? [n.status, 'accent'];
    return `<li class="hal-note">
<div class="note-top"><span class="label">${esc(n.game ? gameName(n.game) : 'The whole studio')}</span>${pill(label, tone)}</div>
<p>${esc(clip(n.text, 2000))}</p>
${n.reply ? `<p class="reply small"><span class="who">Hal</span> ${esc(clip(n.reply, 1000))}</p>` : ''}
<form method="post" action="/notes/clear" class="clear">${hidden('run', run)}${hidden('id', n.id)}<button type="submit" class="inline">Clear</button></form>
</li>`;
  });
  return `<section><h2>Tell Hal</h2>
<form method="post" action="/tell" class="card stack">${hidden('run', run)}
<label class="label" for="tell-game">About</label>
<select name="game" id="tell-game"><option value="">The whole studio</option>${opts}</select>
<label class="label" for="tell-text">What should Hal know?</label>
<textarea name="text" id="tell-text" maxlength="2000" required placeholder="An idea, a gripe, something you noticed while playing"></textarea>
<button type="submit" class="primary">Send to Hal</button>
</form>
${notes.length ? `<div class="card"><ul class="rows">${notes.join('\n')}</ul></div>` : ''}
</section>`;
}

function fixes(v: ReportView, list: CandidateResult[]): string {
  if (!list.length) return '';
  const run = v.report.runId;
  const items = list.map((c) => {
    const form = `<form method="post" action="/undo" class="inline-form">${hidden('run', run)}${hidden('pass', c.pass)}<input type="text" name="reason" maxlength="500" placeholder="Why undo? (optional)" aria-label="Reason to undo ${esc(c.ticket.title)}"><button type="submit" class="inline warn">Undo</button></form>`;
    const line = c.changelog?.trim() || c.summary?.trim() || '';
    return `<li>
<div class="label">${esc(gameName(c.ticket.game))}${c.version ? ` ${esc(c.version)}` : ''} · ${esc(c.pass)}</div>
<div class="item-title">${esc(c.ticket.title)}</div>
${line ? `<p class="small muted">${esc(clip(line, 300))}</p>` : ''}
${withState(changeState(c.pass, v.feedback), form)}
</li>`;
  });
  return `<section><details class="fold"><summary><h2>What got fixed (${list.length})</h2></summary><ul class="rows">${items.join('\n')}</ul></details></section>`;
}

function dropped(list: CandidateResult[]): string {
  if (!list.length) return '';
  const items = list.map((c) => `<li>
<div class="label">${esc(cap(c.ticket.kind))} · ${esc(gameName(c.ticket.game))}${c.pass ? ` · ${esc(c.pass)}` : ''} · ${c.verdict === 'skipped' ? 'not built' : 'dropped'}</div>
<div class="item-title">${esc(c.ticket.title)}</div>
${c.reasons.length ? `<p class="small muted">${esc(clip(c.reasons.join('; '), 300))}</p>` : ''}
</li>`);
  return `<section><details class="fold"><summary><h2>Tried and dropped (${list.length})</h2></summary><ul class="rows">${items.join('\n')}</ul></details></section>`;
}

function planned(list: Ticket[], open: boolean): string {
  if (!list.length) return '';
  const items = list.map((t) => `<li>
<div class="label">${esc(cap(t.kind))} · ${esc(gameName(t.game))}</div>
<div class="item-title">${esc(t.title)}</div>
<p class="small muted">${esc(clip(t.why, 300))}</p>
</li>`);
  return `<section><details class="fold"${open ? ' open' : ''}><summary><h2>Planned, not built (${list.length})</h2></summary><ul class="rows">${items.join('\n')}</ul></details></section>`;
}

function warnings(r: ViewReport): string {
  if (!r.warnings.length) return '';
  return `<section><h2>Warnings</h2><div class="card warnings"><ul class="rows">${r.warnings.map((w) => `<li class="small">${esc(clip(w, 500))}</li>`).join('')}</ul></div></section>`;
}

/** `Nov 12, 1:02 AM` in `timeZone` (default: the local zone); the raw text if it is not a date. */
const when = (iso: string, timeZone?: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(d);
};

function runHal(v: ReportView): string {
  const run = v.report.runId;
  const s = v.status;
  const status = s.running ? `Running${s.phase ? `: ${esc(s.phase)}` : ''}${s.startedAt ? ` (since ${esc(when(s.startedAt, v.timeZone))})` : ''}` : 'Idle';
  const opts = gameOptions(v.games);
  const earlier = v.runs.slice(0, 10).map((x) =>
    `<li><a class="run-link" href="/runs/${esc(encodeURIComponent(x.runId))}"><span>${esc(when(x.endedAt, v.timeZone))}</span>${x.runId === run ? '<span class="pill">this one</span>' : ''}</a></li>`);
  return `<section><h2>Run Hal</h2>
<div class="card stack">
<p class="status"><span class="dot${s.running ? ' on' : ''}" aria-hidden="true"></span><strong>${status}</strong><br><span class="small muted">API spend today: ${usd(v.spendToday)} of ${usd(v.capUsd)}</span></p>
<form method="post" action="/run" class="stack">${hidden('run', run)}
<label class="label" for="run-game">Game</label>
<select name="game" id="run-game"><option value="">All games</option>${opts}</select>
<label class="check"><input type="checkbox" name="reportOnly" value="1"> Report only (plan, don't build)</label>
<button type="submit" class="primary">Run now</button>
</form>
<form method="post" action="/stop">${hidden('run', run)}<button type="submit">Stop</button></form>
</div>
${earlier.length ? `<div class="card"><div class="label">Earlier reports</div><ul class="rows runs">${earlier.join('')}</ul></div>` : ''}
</section>`;
}

// ---- the page ------------------------------------------------------------------------------------------------------

/** Report-only styles, on top of PAGE_CSS. */
const REPORT_CSS = `
.hero{margin:4px 0 0}
.hero h1{margin:6px 0 8px}
.hero .tally{margin:0 0 2px;font-weight:600}
.play{margin-top:16px}
.play .btn{min-height:52px;padding:14px;font-size:18px;border-radius:12px;letter-spacing:.01em}
.play-off{display:flex;align-items:center;gap:12px}
.play-icon{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--accent-soft);color:var(--accent)}
.note p,.note li{font-size:16px}
.note ul,.note ol{margin:0 0 10px;padding-left:22px}
.note li+li{margin-top:4px}
.note strong{font-weight:700}
.note .sign{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;font-style:italic}
.game-top,.note-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.game-name{font-weight:700}
.meter{display:flex;align-items:center;gap:10px;margin-top:8px}
.bar{flex:1;height:6px;border-radius:999px;background:var(--line);overflow:hidden}
.bar>span{display:block;height:100%;border-radius:inherit;background:var(--accent)}
.bar.good>span{background:var(--good)}
.bar.warn>span{background:var(--warn)}
.num{flex:none;font-variant-numeric:tabular-nums}
.why{margin:6px 0 0}
.change h3,.call h3{margin:6px 0 8px;font-size:17px}
.change .lead{margin-bottom:12px}
.shots{margin:0 0 12px}
.shot{position:relative;margin:0;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:var(--bg)}
.shot img{width:100%}
.shot .tag{position:absolute;left:6px;top:6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  padding:3px 7px;border-radius:999px;background:var(--surface);color:var(--fg);opacity:.92}
.score{margin:0 0 12px;font-variant-numeric:tabular-nums}
.delta{font-weight:700;color:var(--muted)}
.delta.good{color:var(--good)}
.delta.warn{color:var(--warn)}
.votes form{display:flex;flex-direction:column;gap:8px}
.votes form>*+*{margin-top:0}
.votes button{margin-top:auto}
.how{margin:-4px 0 12px}
.how>summary{justify-content:flex-start;color:var(--accent);font-weight:600}
.how>summary::after{border-color:var(--accent)}
.state{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 12px;min-height:44px}
.state .pill{font-size:14px;padding:7px 12px;white-space:normal}
.more{flex:1 1 100%}
.more>summary{justify-content:flex-start;color:var(--accent);font-weight:600}
.more>summary::after{border-color:var(--accent)}
.more-body{padding-top:6px}
.state:has(.more:not([open])){flex-wrap:nowrap}
.state:has(.more:not([open])) .more{flex:none}
.ask{margin-top:2px}
.ask strong{font-weight:600}
.item-title{font-weight:600}
.inline-form{display:flex;gap:8px;margin-top:8px}
.inline-form input{flex:1;min-width:0}
.hal-note p{margin:6px 0 0}
.reply{padding:8px 10px;border-radius:10px;background:var(--accent-soft)}
.reply .who{font-weight:700;color:var(--accent);margin-right:4px}
.clear{display:flex;justify-content:flex-end;margin-top:8px}
.warnings{background:var(--warn-soft);border-color:transparent}
.warnings .rows>li{border-color:color-mix(in srgb,var(--warn) 25%,transparent)}
.status{margin:0}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:8px;vertical-align:1px}
.dot.on{background:var(--good);box-shadow:0 0 0 3px var(--good-soft)}
.runs>li{padding:0;border-top:1px solid var(--line)}
.run-link{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;text-decoration:none}
`;

export function renderReport(v: ReportView): string {
  const r = v.report;
  const merged = r.changes.filter((c) => c.verdict === 'merged');
  // Every merged change but a fix is a card (feature, polish, tuning, and any kind added later), so none goes unshown.
  const cards = merged.filter((c) => c.ticket.kind !== 'fix');
  const fixed = merged.filter((c) => c.ticket.kind === 'fix');
  const gone = r.changes.filter((c) => c.verdict !== 'merged');
  const approved = new Set(v.approvals.map(normItem));
  const needYou = r.calls.filter((t) => !approved.has(normItem(t.liability ?? ''))).length;
  const plan = r.planned ?? [];
  return `${pageHead(`Hal · ${r.night}`, REPORT_CSS)}<body><main class="page">
${v.flash ? `<p class="flash" role="status">${esc(clip(v.flash, 300))}</p>` : ''}
${header(v, merged.length, gone.length, needYou)}
${director(v)}
${play(v)}
${standings(v)}
${changes(v, cards)}
${calls(v)}
${tell(v)}
${fixes(v, fixed)}
${dropped(gone)}
${planned(plan, merged.length === 0)}
${warnings(r)}
${runHal(v)}
</main></body></html>`;
}
