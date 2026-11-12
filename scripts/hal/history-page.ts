// A game's History page: score lines, then nights newest first (the director's note, then each change). Pure: data in,
// HTML out. No JavaScript, no outside requests; the filter is a GET form and every link is same-origin.
import type { HistoryEntry, HistoryFilter, HistoryNight } from '@studio/core/hal';
import type { ScoreRun } from './history-git.js';
import { esc, noteHtml, pageHead } from './page-style.js';

export type HistoryView = {
  game: string; title: string; nights: HistoryNight[]; notes: Record<string, string>; scores: ScoreRun[];
  filter: HistoryFilter; focus?: string;
  /** The repo's `git config user.name`: a non-Hal commit by them says "Yours", anyone else's shows the author. */
  me?: string | null;
};

const HISTORY_CSS = `
.top a{display:inline-flex;align-items:center;min-height:44px}
.hero{margin:4px 0 0}.hero .label{margin-bottom:4px}
form.filter{margin:20px 0 0}
.filter .grid2{margin-top:10px}
.filter .go{margin-top:10px}
.chart{width:100%;height:auto;display:block}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart text{fill:var(--muted);font:10px var(--font)}
.chart polyline{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.l0{stroke:var(--accent)}.l1{stroke:var(--good)}.l2{stroke:var(--warn)}.l3{stroke:var(--c3)}.l4{stroke:var(--c4)}.l5{stroke:var(--muted)}
.key{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 14px}
.key li{display:flex;align-items:center;gap:6px;font-size:14px}
.sw{width:14px;height:4px;border-radius:2px;display:inline-block}
.sw.l0{background:var(--accent)}.sw.l1{background:var(--good)}.sw.l2{background:var(--warn)}.sw.l3{background:var(--c3)}.sw.l4{background:var(--c4)}.sw.l5{background:var(--muted)}
:root{--c3:#8a4fbf;--c4:#c0392b}
@media (prefers-color-scheme:dark){:root{--c3:#b98be6;--c4:#ef7f72}}
.night>h2{margin:0 0 10px}
.note{margin:0 0 12px}
details.note-fold{margin:0 0 12px}
details.note-fold>summary{font-weight:600}
.entry{scroll-margin-top:12px}
.entry .head{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 6px}
.entry h3{margin:0 0 4px}
.entry .meta{margin:6px 0 0}
.shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0 0}
.shots figure{margin:0}.shots figcaption{margin-bottom:4px}
.shots img{border-radius:8px;border:1px solid var(--line);width:100%}
.perma{display:inline-flex;align-items:center;min-height:44px}
.entry:target{outline:2px solid var(--accent)}
.empty{text-align:center;padding:24px 0}
`;

export const KINDS = ['fix', 'tuning', 'polish', 'feature'] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function nightTitle(night: string): string {
  const d = new Date(`${night}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night) || Number.isNaN(d.getTime())) return night;
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${night}`;
}

const shotUrl = (game: string, path: string | undefined): string | null => {
  const m = path && /\/(\d{4}-\d{2}-\d{2})\/(HAL-\d+-(?:before|after)\.jpg)$/.exec(path);
  return m ? `/_history/${encodeURIComponent(game)}/img/${m[1]}/${m[2]}` : null;
};

function entryHtml(game: string, e: HistoryEntry, focused: boolean, me?: string | null): string {
  if (e.type === 'brian') {
    const who = me && e.author === me ? 'Yours' : e.author || 'Someone';
    return `<article class="card entry"><div class="head"><span class="pill">${esc(who)}</span><span class="small muted">${esc(nightTitle(e.night))}</span></div><h3>${esc(e.title)}</h3></article>`;
  }
  const st = e.status;
  const status =
    st.kind === 'kept' ? '<span class="pill good">Kept</span>'
    : st.kind === 'undone' ? `<span class="pill warn">${esc(`Undone: ${st.reason || 'no reason given'}`)}</span>`
    : '<span class="pill warn">Reverted later (by you)</span>';
  const shot = (label: string, path: string | undefined) => {
    const u = shotUrl(game, path);
    return u ? `<figure><figcaption class="label">${label}</figcaption><img src="${esc(u)}" alt="${esc(`${label} screenshot for ${e.title}`)}" loading="lazy"></figure>` : '';
  };
  const shots = shot('Before', e.shots.before) + shot('After', e.shots.after);
  const delta = e.scoreAfter - e.scoreBefore;
  const link = focused ? `/_history/${encodeURIComponent(game)}` : `#${e.pass}`;
  return `<article class="card entry" id="${esc(e.pass)}">
<div class="head"><span class="pill">${esc(e.kind)}</span>${status}<span class="small muted">v${esc(e.version)}</span></div>
<h3>${esc(e.title)}</h3>
<p class="small muted">${esc(e.why)}</p>
<p class="small meta">Score ${e.scoreBefore.toFixed(1)} → ${e.scoreAfter.toFixed(1)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})</p>
${shots ? `<div class="shots">${shots}</div>` : ''}
<a class="perma small" href="${esc(link)}">${focused ? 'All history' : esc(e.pass)}</a>
</article>`;
}

function chart(scores: ScoreRun[]): string {
  const lastOfNight = new Map<string, ScoreRun>();
  for (const s of scores) lastOfNight.set(s.night, s); // scores arrive night-sorted, runs in order: the last wins
  const nightsSorted = [...lastOfNight.keys()].sort();
  const head = '<section><h2>Score over time</h2>';
  if (nightsSorted.length < 2) return `${head}<p class="small muted card">Scores over time appear after two nights.</p></section>`;
  const multi = new Set(scores.flatMap((s) => Object.keys(s.scorers))).size > 1;
  const series = new Map<string, Array<number | null>>();
  nightsSorted.forEach((n, i) => {
    for (const [scorer, v] of Object.entries(lastOfNight.get(n)!.scorers)) {
      for (const [m, val] of Object.entries(v.measures)) {
        const key = multi ? `${scorer} · ${m}` : m;
        if (!series.has(key)) series.set(key, nightsSorted.map(() => null));
        series.get(key)![i] = val;
      }
    }
  });
  const W = 320, H = 150, L = 28, R = 8, T = 8, B = 22;
  const x = (i: number) => L + ((W - L - R) * i) / (nightsSorted.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - Math.max(0, Math.min(100, v)) / 100);
  const grid = [0, 50, 100].map((g) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/><text x="${L - 4}" y="${(y(g) + 3).toFixed(1)}" text-anchor="end">${g}</text>`).join('');
  const ends = `<text x="${L}" y="${H - 6}">${esc(nightsSorted[0]!.slice(5))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(nightsSorted.at(-1)!.slice(5))}</text>`;
  const keys = [...series.keys()];
  const lines = keys.map((k, ki) => {
    const pts = series.get(k)!.flatMap((v, i) => (v === null ? [] : [`${x(i).toFixed(1)},${y(v).toFixed(1)}`]));
    return `<polyline class="l${ki % 6}" points="${pts.join(' ')}"><title>${esc(k)}</title></polyline>`;
  }).join('');
  const legend = keys.map((k, ki) => `<li><span class="sw l${ki % 6}"></span>${esc(k)}</li>`).join('');
  return `${head}<div class="card"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores per measure over nights, 0 to 100">${grid}${ends}${lines}</svg><ul class="key">${legend}</ul></div></section>`;
}

function filterForm(game: string, f: HistoryFilter): string {
  const opt = (v: string, label: string, cur: string | undefined) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
  return `<form class="filter card stack" method="get" action="/_history/${esc(encodeURIComponent(game))}">
<label class="label" for="q">Search</label>
<input type="text" id="q" name="q" value="${esc(f.q ?? '')}" autocomplete="off">
<div class="grid2"><div><label class="label" for="kind">Kind</label><select id="kind" name="kind">${opt('', 'Any', f.kind)}${KINDS.map((k) => opt(k, k, f.kind)).join('')}${opt('brian', "Not Hal's", f.kind)}</select></div>
<div><label class="label" for="status">Status</label><select id="status" name="status">${opt('', 'Any', f.status)}${opt('kept', 'Kept', f.status)}${opt('undone', 'Undone', f.status)}</select></div></div>
<button class="primary go" type="submit">Filter</button>
</form>`;
}

export function renderHistory(v: HistoryView): string {
  const back = '<div class="top"><a href="/">← Shelf</a></div>';
  const hero = `<header class="hero"><div class="label">History</div><h1>${esc(v.title)}</h1></header>`;
  let body: string;
  if (v.focus) {
    const e = v.nights.flatMap((n) => n.entries).find((x) => x.type === 'hal' && x.pass === v.focus);
    body = `<section>${e ? entryHtml(v.game, e, true, v.me) : ''}<p class="small"><a class="perma" href="/_history/${esc(encodeURIComponent(v.game))}">See the full history</a></p></section>`;
  } else {
    // Unfiltered, a night with only a director's note (nothing merged for this game) shows too: entry nights and
    // note nights together, newest first. A filter shows matching entries only, so note-only nights drop out.
    const filtered = !!(v.filter.q || v.filter.kind || v.filter.status);
    const byNight = new Map(v.nights.map((n) => [n.night, n]));
    if (!filtered) for (const night of Object.keys(v.notes)) if (!byNight.has(night) && v.notes[night]!.trim()) byNight.set(night, { night, entries: [] });
    const all = [...byNight.values()].sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));
    const nights = all.map((n, i) => {
      const note = v.notes[n.night]?.trim() ? noteHtml(v.notes[n.night]!) : '';
      const noteBlock = !note ? ''
        : i < 3 ? `<div class="card note">${note}</div>`
        : `<details class="fold note-fold"><summary>Hal's note</summary>${note}</details>`;
      return `<section class="night"><h2>${esc(nightTitle(n.night))}</h2>${noteBlock}${n.entries.map((e) => entryHtml(v.game, e, false, v.me)).join('\n')}</section>`;
    }).join('\n');
    body = `${chart(v.scores)}${filterForm(v.game, v.filter)}${nights || '<p class="empty muted">Nothing here yet.</p>'}`;
  }
  return `${pageHead(`${v.title} · History`, HISTORY_CSS)}<body><main class="page">${back}${hero}${body}</main></body></html>`;
}
