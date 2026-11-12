// The report page's one script, served by Hal's own server as /hal.js (CSP `script-src 'self'`; no inline script, no
// eval, no third party). It polls /status.json and updates the Run Hal panel in place: once right after load (a run
// started a moment ago may not have written its lock when the page rendered), then every 5 s, and right away when the
// tab comes back into view. While running, the time since start counts up each second. It only ever sets textContent, `hidden`,
// `value` and data attributes, never HTML. Without it the panel still shows the state as of page load, and every
// button is a plain form POST.

/** How far along a run is, 0..1, from its lock phase (run.ts setPhase); null when the phase says nothing about it. */
export function phaseProgress(phase: string | undefined): number | null {
  if (!phase) return null;
  const build = /^build\b.*\((\d+)\/(\d+)\)/.exec(phase);
  if (build) {
    const i = Number(build[1]), n = Number(build[2]);
    return n > 0 && i >= 1 && i <= n ? 0.2 + (0.7 * (i - 1)) / n : null;
  }
  const at: Record<string, number> = { lock: 0, preflight: 0.03, play: 0.08, plan: 0.15, build: 0.2, note: 0.92, push: 0.96, report: 0.99 };
  const head = phase.split(/[\s:]/)[0]!; // 'preflight: checking ...' is still preflight
  return Object.hasOwn(at, head) ? at[head]! : null;
}

export type StatusJson = {
  running: boolean;
  phase?: string;
  startedAt?: string;
  /** 0..1, or null when unknown (the bar is then indeterminate). */
  progress: number | null;
  /** latest.json's run: the page offers the new report when it differs from the one it was rendered with. */
  latestRunId: string | null;
  /** API dollars booked against the cap today (pending reservations at their full slice). */
  spendToday: number;
  capUsd: number;
  /** Settled subscription dollars today (runs started from the page bill the subscription first). */
  subscriptionToday: number;
  /** Settled dollars of the running run so far, both billings; absent when idle. */
  runSpend?: number;
};

/** The card's spend line: API against the cap, the subscription, and the running run so far. */
export function spendLine(s: Pick<StatusJson, 'spendToday' | 'capUsd' | 'subscriptionToday' | 'runSpend'>): string {
  const usd = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
  return `Today: ${usd(s.spendToday)} of ${usd(s.capUsd)} API · ${usd(s.subscriptionToday)} subscription${typeof s.runSpend === 'number' ? ` · this run ${usd(s.runSpend)}` : ''}`;
}

export const STATUS_JS = `(() => {
  'use strict';
  const el = document.querySelector('[data-hal-status]');
  if (!el || !window.fetch) return;
  const q = (s) => el.querySelector(s);
  const latestAtLoad = el.dataset.latest || '';
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const usd = (n) => '$' + (Number.isFinite(n) ? n : 0).toFixed(2);
  let timer = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms); };
  let started = null;
  const ago = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(t / 60), h = Math.floor(m / 60); return h ? h + 'h ' + (m % 60) + 'm' : m ? m + 'm ' + (t % 60) + 's' : t + 's'; };
  const clock = () => { const n = q('[data-since]'); if (n && started) n.textContent = 'since ' + time.format(started) + ' · ' + ago(Date.now() - started.getTime()); };
  setInterval(clock, 1000);
  const set = (sel, text) => { const n = q(sel); if (n) n.textContent = text; };
  const show = (sel, on) => { const n = q(sel); if (n) n.hidden = !on; };
  function render(s) {
    el.dataset.running = s.running ? '1' : '0';
    set('[data-state]', s.running ? 'Running' : 'Idle');
    set('[data-phase]', s.running ? (s.phase || 'starting') : '');
    started = s.running && s.startedAt ? new Date(s.startedAt) : null;
    set('[data-since]', '');
    clock();
    set('[data-spend]', 'Today: ' + usd(s.spendToday) + ' of ' + usd(s.capUsd) + ' API · ' + usd(s.subscriptionToday) + ' subscription' + (typeof s.runSpend === 'number' ? ' · this run ' + usd(s.runSpend) : ''));
    const bar = q('[data-progress]');
    if (bar) {
      bar.hidden = !s.running;
      if (typeof s.progress === 'number') bar.value = s.progress; else bar.removeAttribute('value');
    }
    show('[data-run-form]', !s.running);
    show('[data-stop-form]', s.running);
    show('[data-new]', !!s.latestRunId && s.latestRunId !== latestAtLoad);
  }
  async function tick() {
    let s;
    try {
      const r = await fetch('/status.json', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      s = await r.json();
    } catch (e) {
      show('[data-offline]', true);
      return later(15000);
    }
    show('[data-offline]', false);
    render(s);
    later(5000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  later(800);
})();
`;
