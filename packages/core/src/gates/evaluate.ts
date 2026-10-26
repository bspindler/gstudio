import type { Game, MetricsSnapshot, Stage } from '../domain/types.js';
import type { Policy } from '../policy/schema.js';

export interface GateContext { now: Date; conceptScore?: number; qaPassed?: boolean; botPlayable?: boolean; storeReadiness?: boolean }
export interface GateCheck { name: string; required: string; actual: string; pass: boolean }
export interface GateEvaluation {
  slug: string;
  fromStage: Stage;
  toStage: Stage | null;
  decision: 'promote' | 'hold' | 'kill';
  insufficientData: boolean;
  checks: GateCheck[];
}

type Verdict = Pick<GateEvaluation, 'decision' | 'insufficientData' | 'checks'>;

const pct = (n: number | null | undefined) => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`);
const fmt = (n: number | null | undefined, digits = 2) => (n == null ? 'n/a' : n.toFixed(digits));
const check = (name: string, required: string, actual: string, pass: boolean): GateCheck => ({ name, required, actual, pass });
const DAY_MS = 864e5;

const fresh = (m: MetricsSnapshot[], now: Date, maxAgeDays: number) =>
  m.filter((s) => now.getTime() - Date.parse(s.asOf) <= maxAgeDays * DAY_MS);

function gateConcept(_g: Game, _m: MetricsSnapshot[], p: Policy, ctx: GateContext): Verdict {
  const min = p.gates['0->1'].min_concept_score;
  if (ctx.conceptScore === undefined) {
    return { decision: 'hold', insufficientData: true, checks: [check('concept_score', `>= ${min}`, 'n/a', false)] };
  }
  const pass = ctx.conceptScore >= min;
  return {
    decision: pass ? 'promote' : 'kill', insufficientData: false,
    checks: [check('concept_score', `>= ${min}`, fmt(ctx.conceptScore), pass)],
  };
}

function gatePrototype(_g: Game, _m: MetricsSnapshot[], p: Policy, ctx: GateContext): Verdict {
  const checks = p.gates['1->2'].require.map((r) => {
    const v = r === 'qa_passed' ? ctx.qaPassed : ctx.botPlayable;
    return check(r, 'true', String(v ?? 'n/a'), v === true);
  });
  return { decision: checks.every((c) => c.pass) ? 'promote' : 'hold', insufficientData: false, checks };
}

function gateWebTest(_g: Game, m: MetricsSnapshot[], p: Policy, ctx: GateContext): Verdict {
  const gate = p.gates['2->3'];
  const web = fresh(m.filter((s) => s.channel === 'portal' || s.channel === 'own_site'), ctx.now, gate.max_metrics_age_days);
  const players = web.reduce((s, x) => s + x.players, 0);
  const ratingCount = web.reduce((s, x) => s + x.ratingCount, 0);
  const avgRating = ratingCount === 0 ? null
    : web.reduce((s, x) => s + (x.avgRating ?? 0) * x.ratingCount, 0) / ratingCount;

  const checks: GateCheck[] = [check('players', `>= ${gate.min_players}`, String(players), players >= gate.min_players)];
  if (players < gate.min_players) return { decision: 'hold', insufficientData: true, checks };

  const channelPass = web.map((s) => {
    const ch = s.channel as 'portal' | 'own_site';
    const pass = s.players >= gate.min_players && s.d1 !== null && s.d1 >= gate.d1[ch];
    checks.push(check(`d1_${ch}`, `>= ${pct(gate.d1[ch])} (n >= ${gate.min_players})`, `${pct(s.d1)} (n=${s.players})`, pass));
    return pass;
  });
  const ratingsEnough = ratingCount >= gate.min_rating_count;
  const ratingPass = ratingsEnough && avgRating !== null && avgRating >= gate.min_avg_rating;
  checks.push(check('rating_count', `>= ${gate.min_rating_count}`, String(ratingCount), ratingsEnough));
  checks.push(check('avg_rating', `>= ${gate.min_avg_rating}`, fmt(avgRating), ratingPass));

  if (channelPass.some(Boolean) && ratingPass) return { decision: 'promote', insufficientData: false, checks };

  const played = web.filter((s) => s.players > 0);
  const clearlyFails = played.length > 0
    && played.every((s) => s.d1 !== null && s.d1 < gate.kill_d1[s.channel as 'portal' | 'own_site']);
  if (clearlyFails) return { decision: 'kill', insufficientData: false, checks };
  return { decision: 'hold', insufficientData: channelPass.some(Boolean) && !ratingsEnough, checks };
}

function gateBeta(_g: Game, m: MetricsSnapshot[], p: Policy, ctx: GateContext): Verdict {
  const gate = p.gates['3->4'];
  const store = m.find((s) => s.channel === 'store');
  const crashFree = store?.crashFreeRate ?? null;
  const checks = [
    check('crash_free', `>= ${pct(gate.min_crash_free)}`, pct(crashFree), crashFree !== null && crashFree >= gate.min_crash_free),
    ...gate.require.map((r) => check(r, 'true', String(ctx.storeReadiness ?? 'n/a'), ctx.storeReadiness === true)),
  ];
  return { decision: checks.every((c) => c.pass) ? 'promote' : 'hold', insufficientData: crashFree === null, checks };
}

function gateSoftLaunch(g: Game, m: MetricsSnapshot[], p: Policy, ctx: GateContext): Verdict {
  const gate = p.gates['4->5'];
  const store = fresh(m.filter((s) => s.channel === 'store'), ctx.now, gate.max_metrics_age_days)[0];
  const ve = g.valueEstimate;
  const maxCpi = ve ? Math.max(...Object.values(ve.cpiUsdByMarket)) : NaN;
  const ratio = ve && Number.isFinite(maxCpi) && maxCpi > 0 ? ve.ltvUsd / maxCpi : null;
  const checks = [
    check('players', `>= ${gate.min_players}`, String(store?.players ?? 0), (store?.players ?? 0) >= gate.min_players),
    check('d1', `>= ${pct(gate.d1)}`, pct(store?.d1), store?.d1 != null && store.d1 >= gate.d1),
    check('d7', `>= ${pct(gate.d7)}`, pct(store?.d7), store?.d7 != null && store.d7 >= gate.d7),
    check('ltv_over_max_cpi', `>= ${gate.min_ltv_over_cpi}`, fmt(ratio), ratio !== null && ratio >= gate.min_ltv_over_cpi),
  ];
  const insufficientData = !store || store.players < gate.min_players || ratio === null;
  if (insufficientData) return { decision: 'hold', insufficientData, checks };
  return { decision: checks.every((c) => c.pass) ? 'promote' : 'hold', insufficientData: false, checks };
}

const GATES: Partial<Record<Stage, (g: Game, m: MetricsSnapshot[], p: Policy, ctx: GateContext) => Verdict>> = {
  0: gateConcept, 1: gatePrototype, 2: gateWebTest, 3: gateBeta, 4: gateSoftLaunch,
};

/** Pure evaluation of a game's next stage gate. Never kills on insufficient data. */
export function evaluateGate(g: Game, m: MetricsSnapshot[], p: Policy, ctx: GateContext): GateEvaluation {
  const gate = GATES[g.stage];
  if (!gate) {
    return {
      slug: g.slug, fromStage: g.stage, toStage: null, decision: 'hold', insufficientData: false,
      checks: [check('not_evaluated', 'Phase 4', `stage ${g.stage}`, false)],
    };
  }
  const v = gate(g, m, p, ctx);
  return { slug: g.slug, fromStage: g.stage, toStage: (g.stage + 1) as Stage, ...v };
}
