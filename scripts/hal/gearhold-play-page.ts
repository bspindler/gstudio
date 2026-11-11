// In-page driver for gearhold-play.ts. Bundled by esbuild into an IIFE and added to the page after load, so
// the decide -> step loop runs inside the browser without a Node round trip per decision. It installs
// globalThis.__halPlay; the runner calls begin() once and batch() until it returns a final outcome.
import { createMemory, decide, mulberry32, SUBSTEPS, type GearholdInput, type GearholdState } from '../../packages/core/src/hal/gearhold-bot.js';

const DT = 1 / 60;

type Hal = { start(level: number): void; state(): GearholdState; step(dt: number, input: GearholdInput): GearholdState };
export type PageOutcome =
  | { done: false; time: number }
  | { done: true; ok: true; state: GearholdState; result: 'win' | 'dead' | 'timeout'; cause: string }
  | { done: true; ok: false; error: string };

/** The first non-finite number in a state, as a path, or '' when every number is finite. */
function nonFinite(v: unknown, path: string): string {
  if (typeof v === 'number') return Number.isFinite(v) ? '' : path;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = nonFinite(v[i], `${path}[${i}]`); if (r) return r; } return ''; }
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { const r = nonFinite(x, `${path}.${k}`); if (r) return r; } }
  return '';
}

const f1 = (x: number): string => x.toFixed(1);

function deathCause(s: GearholdState): string {
  let best: { kind: string; d: number } | null = null;
  for (const e of s.enemies) {
    if (e.dead || e.prop || !e.awake) continue;
    const d = Math.hypot(e.x - s.p.x, e.y - s.p.y);
    if (!best || d < best.d) best = { kind: e.kind, d };
  }
  return `killed at ${f1(s.time)} s at (${f1(s.p.x)},${f1(s.p.y)})` +
    (best ? `, nearest awake enemy ${best.kind} at ${f1(best.d)} tiles` : ', no awake enemy near (explosion?)') +
    `, kills ${s.kills}/${s.foes}`;
}

let run: {
  hal: Hal; map: string[]; mem: ReturnType<typeof createMemory>; rng: () => number;
  s: GearholdState; trail: { t: number; x: number; y: number }[]; cap: number;
} | null = null;

function timeoutCause(s: GearholdState, trail: { t: number; x: number; y: number }[], cap: number): string {
  const old = trail.find((q) => q.t >= s.time - 20) ?? trail[0]!;
  const moved = Math.hypot(s.p.x - old.x, s.p.y - old.y);
  const kind = moved < 1.5 ? 'stuck' : 'wandering';
  return `${kind}: ${cap} s sim cap at (${f1(s.p.x)},${f1(s.p.y)}), moved ${f1(moved)} tiles in the last 20 s, ` +
    `kills ${s.kills}/${s.foes}, hp ${s.p.hp}, key ${s.p.key}`;
}

function begin(level: number, map: string[], policySeed: number, cap: number): void {
  const hal = (globalThis as any).__hal as Hal | undefined;
  if (!hal) throw new Error('window.__hal missing (page not loaded with ?hal)');
  hal.start(level);
  const s = hal.state();
  if (s.mode !== 'play' || s.level !== level) throw new Error(`level ${level} did not start (mode=${s.mode}, level=${s.level})`);
  run = { hal, map, mem: createMemory(), rng: mulberry32(policySeed), s, trail: [{ t: s.time, x: s.p.x, y: s.p.y }], cap };
}

/** Runs up to `decisions` decisions (SUBSTEPS steps each). */
function batch(decisions: number): PageOutcome {
  if (!run) return { done: true, ok: false, error: 'batch() before begin()' };
  const r = run;
  for (let n = 0; n < decisions; n++) {
    const bad = nonFinite(r.s, 'state');
    if (bad) return { done: true, ok: false, error: `non-finite value ${bad} at t=${r.s.time}` };
    if (r.s.result) {
      const cause = r.s.result === 'win' ? `exit reached at ${f1(r.s.time)} s, kills ${r.s.kills}/${r.s.foes}` : deathCause(r.s);
      return { done: true, ok: true, state: r.s, result: r.s.result, cause };
    }
    if (r.s.time >= r.cap - 1e-6) return { done: true, ok: true, state: r.s, result: 'timeout', cause: timeoutCause(r.s, r.trail, r.cap) };
    const input = decide(r.s, r.map, r.mem, r.rng);
    for (let k = 0; k < SUBSTEPS && !r.s.result; k++) r.s = r.hal.step(DT, input);
    const last = r.trail[r.trail.length - 1]!;
    if (r.s.time - last.t >= 1) {
      r.trail.push({ t: r.s.time, x: r.s.p.x, y: r.s.p.y });
      if (r.trail.length > 30) r.trail.shift();
    }
  }
  return { done: false, time: r.s.time };
}

(globalThis as any).__halPlay = { begin, batch };
