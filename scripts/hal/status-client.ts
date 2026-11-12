// The report page's one script, served by Hal's own server as /hal.js (CSP `script-src 'self'`; no inline script, no
// eval, no third party). It polls /status.json and updates the Run Hal panel in place: every 5 s while a run is going,
// every 30 s when idle, and right away when the tab comes back into view. It only ever sets textContent, `hidden`,
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
  const head = phase.split(/\s/)[0]!;
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
  spendToday: number;
  capUsd: number;
};

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
  const set = (sel, text) => { const n = q(sel); if (n) n.textContent = text; };
  const show = (sel, on) => { const n = q(sel); if (n) n.hidden = !on; };
  function render(s) {
    el.dataset.running = s.running ? '1' : '0';
    set('[data-state]', s.running ? 'Running' : 'Idle');
    set('[data-phase]', s.running ? (s.phase || 'starting') : '');
    set('[data-since]', s.running && s.startedAt ? 'since ' + time.format(new Date(s.startedAt)) : '');
    set('[data-spend]', usd(s.spendToday) + ' of ' + usd(s.capUsd) + ' API today');
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
      return later(30000);
    }
    show('[data-offline]', false);
    render(s);
    later(s.running ? 5000 : 30000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  later(el.dataset.running === '1' ? 5000 : 30000);
})();
`;
