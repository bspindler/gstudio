// The morning report: one run's report.json, its note and the feedback on it, as an HTML page. Two columns from 840px
// (Material 3's expanded width): the report on the left, and a panel that stays in view on the right (Run Hal with its
// live status, Tell Hal, the latest reports). One column below that, Run Hal first. Pure: data in, HTML string out.
// Every action is a same-origin form POST that carries the run id. The only script is Hal's own /hal.js (live status),
// and everything works without it.
// Every user and Claude string goes through esc. Fields added by plan 3 (perGame, Vote.comment) are optional.
import type { Ticket } from '@studio/core/hal';
import type { CandidateResult } from './candidate.js';
import { esc, noteHtml, pageHead } from './page-style.js';
import { phaseProgress, spendLine } from './status-client.js';
import type { RunReport } from './run.js';
import { lastAt, threadOf, type Note, type Undo, type Vote } from './store.js';

// perGame and Vote.comment land with Task 2; typed here as optional so this compiles before and after it.
type ViewReport = RunReport & { perGame?: Record<string, string> };
type ViewVote = Vote & { comment?: string };
/** `version` is the undo's new game version when the store has it. */
type ViewUndo = Undo & { version?: string };

export type ReportView = {
  report: ViewReport; note: string;
  feedback: { votes: ViewVote[]; undos: ViewUndo[] };   // this run's (store.feedbackFor)
  notes: Note[];                                          // every thread Brian has not cleared, for Tell Hal
  approvals: string[];                                    // approved liability items
  status: { running: boolean; phase?: string; startedAt?: string };
  /** latest.json's run when the page was rendered: /hal.js offers the new report once a newer one exists. */
  latestRunId?: string | null;
  spendToday: number; capUsd: number;
  /** Settled subscription dollars today, and the running run's so far (see server spendOf). */
  subscriptionToday?: number; runSpend?: number;
  playUrl: string | null;
  /** How many commits refs/hal/main has that the checkout's HEAD lacks (Play serves the checkout); absent when unknown. */
  behindHal?: number;
  games: string[];
  runs: Array<{ runId: string; endedAt: string }>;       // the newest few, for the panel's "Earlier reports", newest first
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
/** How many rows a list that keeps growing shows before "Show all N". */
export const LIST_HEAD = 5;
/** The first LIST_HEAD rows, and the rest folded under "Show all N" (no script needed). */
const capped = (items: string[], cls = 'rows') => items.length <= LIST_HEAD
  ? `<ul class="${cls}">${items.join('\n')}</ul>`
  : `<ul class="${cls}">${items.slice(0, LIST_HEAD).join('\n')}</ul><details class="rest"><summary>Show all ${items.length}</summary><ul class="${cls} rest-rows">${items.slice(LIST_HEAD).join('\n')}</ul></details>`;

// ---- the director's note -------------------------------------------------------------------------------------------

export { noteHtml };

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
  const h1 = merged ? "Good morning. Here's what changed." : r.trigger === 'nightly' ? 'Nothing changed overnight.' : 'Nothing changed this run.';
  const spend = `${usd(r.spend.api)} API · ${usd(r.spend.subscription)} subscription${r.capReached ? ' · daily cap reached' : ''}`;
  return `<header class="hero head">
<div class="label">${esc(nightLabel(r))}</div>
<h1>${esc(h1)}</h1>
<p class="tally"><span class="pill${merged ? ' good' : ' outline'}">${merged} merged</span> <span class="pill outline">${dropped} tried and dropped</span> <span class="pill${needYou ? ' warn' : ' outline'}">${needYou} need you</span></p>
<p class="small muted">Spent ${esc(spend)}</p>
</header>`;
}

function director(v: ReportView): string {
  if (!v.note.trim()) return '';
  const r = v.report;
  // A reply starts a Tell Hal thread tied to this report, so Hal knows which note it answers (next run).
  return `<section><h2>${esc("Director's note")}</h2><div class="card note">
${noteHtml(v.note)}
<p class="sign">— Hal · ${usd(r.spend.api)} API, ${usd(r.spend.subscription)} subscription</p>
<form method="post" action="/tell" class="reply-form note-reply">${hidden('run', r.runId)}${hidden('ref', r.runId)}<textarea name="text" rows="2" maxlength="2000" required placeholder="Reply to Hal&#39;s note" aria-label="Reply to the Director's note"></textarea><button type="submit" class="tonal inline">Reply</button></form>
</div></section>`;
}

function play(v: ReportView): string {
  const n = v.behindHal;
  // The dev server serves Brian's checkout; Hal's merges sit on refs/hal/main until he pulls.
  const behind = typeof n === 'number' && Number.isInteger(n) && n > 0
    ? `<p class="behind small">Play shows your checkout, which is ${n} Hal commit${n === 1 ? '' : 's'} behind. Run <code>git pull</code> on the Mac to play last night${esc("'")}s changes.</p>`
    : '';
  return v.playUrl
    ? `<section class="play"><a class="btn primary" href="${esc(v.playUrl)}">▶ Play</a>${behind}</section>`
    : `<section class="play"><div class="card play-off"><span class="play-icon" aria-hidden="true">▶</span><div><strong>Play</strong><br><span class="small muted">Start <code>npm run dev:lan</code> on the Mac to play here</span></div></div>${behind}</section>`;
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
${why ? `<div class="why small muted">${noteHtml(why.length > 900 ? `${why.slice(0, 899)}…` : why)}</div>` : ''}
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
  return `<section><h2>Changes</h2><div class="changes-grid">${cards.map((c) => changeCard(v, c)).join('\n')}</div></section>`;
}

/** Brian tapped "Leave it" on this call in this run: the newest vote on the item is down. */
const isDeclined = (v: ReportView, item: string) => v.feedback.votes.filter((x) => x.item === item).at(-1)?.vote === 'down';

function calls(v: ReportView): string {
  const r = v.report;
  if (!r.calls.length) return '';
  const approved = new Set(v.approvals.map(normItem));
  const cards = r.calls.map((t: Ticket) => {
    const item = t.liability ?? '';
    const isApproved = approved.has(normItem(item));
    const declined = isDeclined(v, item);
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
  open: ['Waiting for Hal', 'accent'], acted: ['Done', 'good'], queued: ['Queued', 'accent'], asked: ['Hal asked you', 'warn'],
};
/** Messages a thread shows before "Earlier messages". */
const THREAD_TAIL = 6;

/** One thread: what it is about, its state, its messages (oldest first, the last few shown), a reply box and Clear. */
function thread(v: ReportView, n: Note, run: string): string {
  const [label, tone] = NOTE_STATUS[n.status] ?? [n.status, 'accent'];
  const about = n.ref
    ? `<a class="label" href="/runs/${esc(encodeURIComponent(n.ref.run))}">${esc("Re: the Director's note")}${n.ref.night ? ` of ${esc(n.ref.night)}` : ''}</a>`
    : `<span class="label">${esc(n.game ? gameName(n.game) : 'The whole studio')}</span>`;
  const msg = (m: ReturnType<typeof threadOf>[number]) => `<div class="msg ${m.from === 'hal' ? 'hal' : 'me'}"><div class="who small">${m.from === 'hal' ? 'Hal' : 'You'} · ${esc(when(m.at, v.timeZone))}</div><p>${esc(clip(m.text, 2000))}</p></div>`;
  const all = threadOf(n);
  const older = all.slice(0, -THREAD_TAIL), recent = all.slice(-THREAD_TAIL);
  const ask = n.status === 'asked';
  return `<li class="thread${ask ? ' asks' : ''}" id="${esc(n.id)}">
<div class="note-top">${about}${pill(label, tone)}</div>
${older.length ? `<details class="rest"><summary>Earlier messages (${older.length})</summary>${older.map(msg).join('')}</details>` : ''}
<div class="msgs">${recent.map(msg).join('')}</div>
<form method="post" action="/notes/reply" class="reply-form">${hidden('run', run)}${hidden('id', n.id)}<textarea name="text" rows="1" maxlength="2000" required placeholder="${ask ? 'Answer Hal' : 'Reply'}" aria-label="Reply in ${esc(n.id)}"></textarea><button type="submit" class="${ask ? 'primary' : 'tonal'} inline">Send</button></form>
<form method="post" action="/notes/clear" class="clear">${hidden('run', run)}${hidden('id', n.id)}<button type="submit" class="inline text">Clear</button></form>
</li>`;
}

function tell(v: ReportView): string {
  const run = v.report.runId;
  const opts = gameOptions(v.games);
  // Threads waiting on Brian first, then by newest message.
  const order = [...v.notes].sort((a, b) => Number(b.status === 'asked') - Number(a.status === 'asked') || lastAt(b).localeCompare(lastAt(a)));
  const threads = order.map((n) => thread(v, n, run));
  return `<section class="tell"><h2>Tell Hal</h2>
<form method="post" action="/tell" class="card compose stack">${hidden('run', run)}
<label class="label" for="tell-game">New thread about</label>
<select name="game" id="tell-game"><option value="">The whole studio</option>${opts}</select>
<label class="label" for="tell-text">Message</label>
<textarea name="text" id="tell-text" rows="2" maxlength="2000" required placeholder="An idea, a gripe, something you noticed while playing"></textarea>
<button type="submit" class="primary">Send to Hal</button>
</form>
${threads.length ? capped(threads, 'threads') : ''}
<p class="small muted hint">Hal reads every thread and answers in its next run.</p>
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
  return `<section><details class="fold"${open ? ' open' : ''}><summary><h2>Planned, not built (${list.length})</h2></summary>${capped(items)}</details></section>`;
}

function warnings(r: ViewReport): string {
  if (!r.warnings.length) return '';
  return `<section><h2>Warnings</h2><div class="card warnings">${capped(r.warnings.map((w) => `<li class="small">${esc(clip(w, 500))}</li>`))}</div></section>`;
}

/** `Nov 12, 1:02 AM` in `timeZone` (default: the local zone); the raw text if it is not a date. */
const when = (iso: string, timeZone?: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(d);
};

type RunHalView = Pick<ReportView, 'status' | 'spendToday' | 'capUsd' | 'subscriptionToday' | 'runSpend' | 'games' | 'runs' | 'timeZone' | 'latestRunId'>;

/** The Run Hal card: the state as of now (kept live by /hal.js), and Run now or Stop, whichever applies. */
function runHal(v: RunHalView, run: string): string {
  const s = v.status;
  const p = s.running ? phaseProgress(s.phase) : null;
  const opts = gameOptions(v.games);
  return `<section class="runhal" aria-labelledby="runhal-h"><div class="card run-card stack" data-hal-status data-running="${s.running ? '1' : '0'}" data-latest="${esc(v.latestRunId ?? '')}">
<h2 id="runhal-h">Run Hal</h2>
<p class="status" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><strong data-state>${s.running ? 'Running' : 'Idle'}</strong> <span data-phase>${s.running ? esc(s.phase ?? 'starting') : ''}</span><br>
<span class="small" data-since>${s.running && s.startedAt ? `since ${esc(when(s.startedAt, v.timeZone))}` : ''}</span></p>
<progress data-progress max="1"${p !== null ? ` value="${p.toFixed(3)}"` : ''}${s.running ? '' : ' hidden'} aria-label="Run progress"></progress>
<p class="small" data-spend>${esc(spendLine({ spendToday: v.spendToday, capUsd: v.capUsd, subscriptionToday: v.subscriptionToday ?? 0, ...(s.running && typeof v.runSpend === 'number' ? { runSpend: v.runSpend } : {}) }))}</p>
<p class="small new" data-new hidden><a href="/">A new report is ready: see it</a></p>
<p class="small offline" data-offline hidden>Can't reach Hal right now; the status may be out of date.</p>
<form method="post" action="/run" class="stack" data-run-form${s.running ? ' hidden' : ''}>${hidden('run', run)}
<label class="label" for="run-game">Game</label>
<select name="game" id="run-game"><option value="">All games</option>${opts}</select>
<label class="check"><input type="checkbox" name="reportOnly" value="1"> Report only (plan, don't build)</label>
<button type="submit" class="primary">Run now</button>
</form>
<form method="post" action="/stop" data-stop-form${s.running ? '' : ' hidden'}>${hidden('run', run)}<button type="submit">Stop</button></form>
</div></section>`;
}

/** The panel's newest reports, and a link to all of them. */
function recent(v: RunHalView, run: string): string {
  const rows = v.runs.slice(0, LIST_HEAD).map((x) =>
    `<li><a class="run-link" href="/runs/${esc(encodeURIComponent(x.runId))}"><span>${esc(when(x.endedAt, v.timeZone))}</span>${x.runId === run ? '<span class="pill">this one</span>' : ''}</a></li>`);
  if (!rows.length) return '';
  return `<section class="recent"><div class="card"><div class="label">Earlier reports</div><ul class="rows runs">${rows.join('')}</ul>
<a class="all-link small" href="/runs">All reports</a></div></section>`;
}

/** The two-column shell: header and report in the main column, the panel beside it. */
const shell = (title: string, head: string, main: string, side: string, flash?: string) =>
  `${pageHead(title, REPORT_CSS)}<body><div class="app">
${flash ? `<p class="flash head" role="status">${esc(clip(flash, 300))}</p>` : ''}
${head}
<aside class="side" aria-label="Run Hal and notes">${side}</aside>
<main class="main">${main}</main>
</div><script src="/hal.js" defer></script></body></html>`;

export type RunsIndexView = {
  runs: Array<{ runId: string; endedAt: string; trigger?: string; merged: number; dropped: number }>;
  page: number; pages: number; timeZone?: string;
};

/** /runs: every report, newest first, grouped by day, RUNS_PER_PAGE to a page. */
export function renderRunsIndex(v: RunsIndexView): string {
  const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'Unknown day' : new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: v.timeZone }).format(d); };
  const time = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: v.timeZone }).format(d); };
  const groups: Array<{ day: string; rows: string[] }> = [];
  for (const r of v.runs) {
    const d = day(r.endedAt);
    if (groups.at(-1)?.day !== d) groups.push({ day: d, rows: [] });
    groups.at(-1)!.rows.push(`<li><a class="run-link" href="/runs/${esc(encodeURIComponent(r.runId))}"><span>${esc(time(r.endedAt))} · ${r.trigger === 'nightly' ? 'overnight' : 'manual'}</span><span class="small muted">${r.merged} merged · ${r.dropped} dropped</span></a></li>`);
  }
  const nav = v.pages > 1 ? `<nav class="pager small" aria-label="Pages">${v.page > 1 ? `<a href="/runs?page=${v.page - 1}">Newer</a>` : '<span></span>'}<span class="muted">Page ${v.page} of ${v.pages}</span>${v.page < v.pages ? `<a href="/runs?page=${v.page + 1}">Older</a>` : '<span></span>'}</nav>` : '';
  const body = groups.length
    ? groups.map((g) => `<section><h2>${esc(g.day)}</h2><div class="card"><ul class="rows runs">${g.rows.join('')}</ul></div></section>`).join('\n')
    : '<p class="muted">No reports yet.</p>';
  return `${pageHead('Hal · All reports', REPORT_CSS)}<body><main class="page">
<header class="hero"><a class="small" href="/">← Latest report</a><h1>All reports</h1></header>
${body}
${nav}
</main></body></html>`;
}

// ---- the page ------------------------------------------------------------------------------------------------------

/** Report-only styles, on top of PAGE_CSS. */
const REPORT_CSS = `
/* ---- layout: one column below 840px (Run Hal first), two from 840px with the panel in view as you scroll ---- */
.app{display:flex;flex-direction:column;gap:0;max-width:600px;margin:0 auto;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
.side{display:contents}
.app>.flash{order:-1}
.head{order:0}
.runhal{order:1;margin-top:20px}
.main{order:2}
.side-rest{order:3}
.main>section:first-child{margin-top:28px}
@media (min-width:840px){
  .app{display:grid;grid-template-columns:minmax(0,1fr) 360px;grid-template-areas:"flash flash" "head side" "main side";
    column-gap:24px;max-width:1280px;padding:24px}
  .app>.flash{grid-area:flash}
  .head{grid-area:head}
  .main{grid-area:main;min-width:0}
  /* One scrollbar: the panel scrolls with the page; only Run Hal stays pinned at the top of its column, and the rest of
     the panel slides under it (it is opaque). The column spans the whole page height, so the pin holds to the bottom. */
  .side{display:block;grid-area:side;align-self:stretch}
  .runhal{position:sticky;top:0;z-index:2;margin:-24px 0 0;padding:24px 0 12px;background:var(--bg)}
  .changes-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;align-items:start}
  .changes-grid>.card{margin:0}
}
.side-rest>section{margin-top:16px}
.side h2{font-size:16px;line-height:24px;font-weight:500;margin-bottom:8px}
.side-rest p,.side-rest li{font-size:14px;line-height:20px}
.hero{margin:4px 0 0}
.hero h1{margin:6px 0 10px}
.hero .tally{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
/* ---- Run Hal ---- */
.run-card{position:relative;background:var(--accent-soft);color:var(--md-on-secondary-container);border-color:transparent}
.run-card[data-running="1"]{background:var(--md-primary-container);color:var(--md-on-primary-container)}
.run-card h2{font-size:16px;line-height:24px;font-weight:500;margin:0}
.run-card .status{margin:0}
.run-card .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--md-outline);margin-right:8px;vertical-align:0}
.run-card[data-running="1"] .dot{background:var(--good);box-shadow:0 0 0 3px var(--good-soft);animation:hal-pulse 1.4s ease-in-out infinite}
@keyframes hal-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.run-card[data-running="1"] .dot{animation:none}}
.run-card [data-phase]{font-variant-numeric:tabular-nums}
.run-card progress{display:block;width:100%;height:4px;border:0;border-radius:2px;background:var(--md-surface-high);accent-color:var(--accent);-webkit-appearance:none;appearance:none}
.run-card progress[hidden]{display:none}
.run-card progress::-webkit-progress-bar{background:color-mix(in srgb,var(--md-on-primary-container) 15%,transparent);border-radius:2px}
.run-card progress::-webkit-progress-value{background:var(--accent);border-radius:2px}
.run-card progress::-moz-progress-bar{background:var(--accent);border-radius:2px}
.run-card select{background:var(--surface)}
.run-card .new a{font-weight:500}
.run-card .offline{color:var(--warn)}
.all-link{display:inline-flex;align-items:center;min-height:44px;margin-top:4px;font-weight:500}
.pager{display:flex;justify-content:space-between;align-items:center;margin-top:24px;min-height:44px}
.play{margin-top:16px}
.play .btn{min-height:56px;padding:16px;font-size:16px;border-radius:16px}
.behind{margin:8px 2px 0;color:var(--muted)}
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
.why p{margin:4px 0 0}
.why ul,.why ol{margin:4px 0 0;padding-left:20px}
.change h3,.call h3{margin:6px 0 8px;font-size:17px}
.change .lead{margin-bottom:12px}
.shots{margin:0 0 12px}
.shot{position:relative;margin:0;border-radius:8px;overflow:hidden;border:1px solid var(--line);background:var(--bg)}
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
/* ---- Tell Hal: threads of messages ---- */
.threads{list-style:none;margin:12px 0 0;padding:0}
.threads>li{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:12px}
.threads>li:first-child{margin-top:0}
.threads>li.asks{border-color:var(--warn)}
.msgs,.thread details.rest{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.thread details.rest>summary{padding-top:0}
.msg{max-width:92%;padding:8px 12px;border-radius:16px}
.msg p{margin:2px 0 0;font-size:14px;line-height:20px}
.msg .who{font-size:12px;line-height:16px;color:var(--muted)}
.msg.me{align-self:flex-end;background:var(--accent-soft);color:var(--md-on-secondary-container);border-bottom-right-radius:4px}
.msg.hal{align-self:flex-start;background:var(--md-surface-container);border-bottom-left-radius:4px}
.msg.hal .who{color:var(--accent);font-weight:500}
.reply-form{display:flex;align-items:flex-end;gap:8px;margin-top:10px}
.reply-form textarea{flex:1;min-width:0;min-height:44px;padding:10px 12px;font-size:16px;resize:vertical}
.reply-form textarea:focus{padding:9px 11px}
.note-reply{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.clear{display:flex;justify-content:flex-end;margin-top:4px}
button.text{border-color:transparent;background:none;color:var(--accent);padding:8px 12px}
.compose textarea{min-height:64px}
.tell .hint{margin:8px 2px 0}
.warnings{background:var(--warn-soft);border-color:transparent}
.warnings .rows>li{border-color:color-mix(in srgb,var(--warn) 25%,transparent)}
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
  const needYou = r.calls.filter((t) => !approved.has(normItem(t.liability ?? '')) && !isDeclined(v, t.liability ?? '')).length;
  const plan = r.planned ?? [];
  const main = [director(v), play(v), calls(v), changes(v, cards), standings(v), fixes(v, fixed), dropped(gone), planned(plan, merged.length === 0), warnings(r)].join('\n');
  const side = `${runHal(v, r.runId)}\n<div class="side-rest">${tell(v)}\n${recent(v, r.runId)}</div>`;
  return shell(`Hal · ${r.night}`, header(v, merged.length, gone.length, needYou), main, side, v.flash);
}

/** The page before Hal's first report: Run Hal and the latest reports only. */
export function renderRunHalOnly(v: RunHalView & { flash?: string }): string {
  const head = '<header class="hero head"><h1>Hal</h1><p class="muted">No report yet. Start a run and its report shows up here.</p></header>';
  return shell('Hal', head, '', `${runHal(v, '')}\n<div class="side-rest">${recent(v, '')}</div>`, v.flash);
}
