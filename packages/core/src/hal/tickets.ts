// Hal tickets: validation of the planner's JSON and the liability split. Pure: no clock, no randomness, no I/O.
export type TicketKind = 'fix' | 'tuning' | 'polish' | 'feature';
export type Ticket = {
  id: string; game: string; kind: TicketKind;
  /** At most 80 characters. */
  title: string; why: string;
  /** A measure name of `game`. */
  target?: string;
  /** Set when the ticket touches anti-goal 1 (dependency, network host, billing, assets...). Needs Brian's approval. */
  liability?: string;
  /** The id of the note of Brian's this ticket acts on. */
  fromNote?: string;
};
export type Approval = { item: string; at: string; by: 'brian' };
/** One ticket the planner proposed that was not kept, with why. `index` is 1-based. */
export type RejectedTicket = { index: number; id?: string; title?: string; reasons: string[] };
/**
 * Batch problems (not JSON, wrong shape, more than MAX_TICKETS) reject the whole plan (`ok: false`). Otherwise each
 * ticket is judged on its own: the valid ones are kept and every other one is listed in `rejected` with its reasons.
 */
export type TicketResult = { ok: true; tickets: Ticket[]; rejected: RejectedTicket[] } | { ok: false; errors: string[] };

export const MAX_TICKETS = 8;
export const MAX_TITLE = 80;
const KINDS: readonly string[] = ['fix', 'tuning', 'polish', 'feature'];

// No "touch" (touch targets, touch input) and no "fix" (every ticket fixes something): only verbs that change a thing.
const EDIT = '(?:edit|change|modify|update|loosen|relax|tweak|rewrite|disable|skip|bypass|remove|delete|weaken|patch|replace)';
// A game's own score UI is ordinary polish ("the score panel"): "score" there is not Hal's scorer.
const SCORE = '(?:score(?!\\s+(?:panel|display|text|label|counter|popup|pop-up|font|readout|hud|ui|screen|area|box|line|bar)s?\\b)|scores|scorers?|scoring)';
// Heuristic: a verb aimed at Hal's own machinery, or a path that is protected. Errs toward rejecting; the planner can rephrase.
// A bare "gate" is a game object (Gearhold has gates): only Hal's gate by name counts.
const PROTECTED: RegExp[] = [
  new RegExp(`\\b${EDIT}\\b[^.;\\n]{0,24}\\b(?:${SCORE}|tripwires?|baseline|ledger|compliance|policy|gateway)\\b`, 'i'),
  /\b(?:hal(?:'s)?|keep|quality|score|scoring)[- ]gates?\b/i,
  /\b(?:policy|markets)\.yaml\b/i,
  /\bCLAUDE\.md\b/,
  /\.hal\.env\b/,
  /(?:^|[\s`'"(])(?:scripts\/hal(?:\.ts|\/)|packages\/core\/src\/hal|packages\/core\/test\/hal-|infra\/|\.github\/|\.data\/|docs\/superpowers)/,
  /\bgearhold\/levels\.d\.ts\b/,
  /\bhal hook\b/i,
];
// Heuristic: text that reads like a dependency, a new host or real money, but carries no `liability` field. In-game
// currency ("shop prices in coins") is not money: only real-money signals count.
const LIABILITY: RegExp[] = [
  /\bcdn\b/i, /\bnpm (?:install|i)\b/i, /\b(?:add|install|import|use)\b[^.;\n]{0,20}\b(?:dependency|dependencies|library|package|framework|engine)\b/i,
  /\bpackage(?:-lock)?\.json\b/i, /\banalytics\b/i, /\bhttps?:\/\//i, /\burls?\b/i,
  /[$€£]/, /\breal[- ]money\b/i, /\b(?:iap|in-app purchases?|purchases?|purchasing|subscriptions?)\b/i,
  /\b(?:ads|adverts?|advertising|advertisements?|ad (?:network|banner|sdk)s?)\b/i,
  /\bgoogle fonts\b/i, /\bapi key\b/i,
];

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** `json` is the planner's parsed `{tickets:[...]}` or its raw text. `measures` maps game slug to its measure names. */
export function validateTickets(json: unknown, games: string[], measures: Record<string, string[]>): TicketResult {
  let data = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch (e) { return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] }; }
  }
  const list = (data as { tickets?: unknown } | null)?.tickets;
  if (!Array.isArray(list)) return { ok: false, errors: ['expected {"tickets":[...]}'] };
  if (list.length > MAX_TICKETS) return { ok: false, errors: [`more than ${MAX_TICKETS} tickets (${list.length})`] };
  const ids = new Set<string>(), titles = new Set<string>();
  const out: Ticket[] = [];
  const rejected: RejectedTicket[] = [];
  list.forEach((raw, i) => {
    const errors: string[] = [];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { rejected.push({ index: i + 1, reasons: ['not an object'] }); return; }
    const k = raw as Record<string, unknown>;
    const str = (f: string) => typeof k[f] === 'string' && (k[f] as string).trim() !== '';
    for (const f of ['id', 'game', 'title', 'why']) if (!str(f)) errors.push(`${f} must be a non-empty string`);
    for (const f of ['target', 'liability', 'fromNote']) if (k[f] !== undefined && !str(f)) errors.push(`${f} must be a non-empty string when present`);
    if (typeof k.kind !== 'string' || !KINDS.includes(k.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
    if (typeof k.title === 'string' && k.title.length > MAX_TITLE) errors.push(`title is over ${MAX_TITLE} characters`);
    // A duplicate of a ticket already kept is rejected; the first one stays.
    if (str('id') && ids.has(k.id as string)) errors.push(`duplicate id ${k.id}`);
    if (str('title') && titles.has(norm(k.title as string))) errors.push(`duplicate title "${k.title}"`);
    if (str('game')) {
      if (!games.includes(k.game as string)) errors.push(`unknown game ${k.game}`);
      else if (str('target') && !(Object.hasOwn(measures, k.game as string) && measures[k.game as string]!.includes(k.target as string))) {
        errors.push(`unknown measure ${k.target} for ${k.game}`);
      }
    }
    const text = `${k.title ?? ''}\n${k.why ?? ''}`;
    if (PROTECTED.some((re) => re.test(text))) errors.push('touches a protected area by its own description');
    else if (k.liability === undefined && LIABILITY.some((re) => re.test(text))) errors.push('looks like a liability item (dependency, host, money); set "liability"');
    if (errors.length) {
      rejected.push({ index: i + 1, ...(str('id') ? { id: k.id as string } : {}), ...(typeof k.title === 'string' ? { title: k.title } : {}), reasons: errors });
      return;
    }
    ids.add(k.id as string);
    titles.add(norm(k.title as string));
    out.push(raw as Ticket);
  });
  return { ok: true, tickets: out, rejected };
}

/** Liability tickets with no matching approval become `calls` (asked in the report); the rest are built, liability field kept. */
export function splitLiability(tickets: Ticket[], approvals: Approval[]): { build: Ticket[]; calls: Ticket[] } {
  const approved = new Set(approvals.map((a) => norm(a.item)));
  const build: Ticket[] = [], calls: Ticket[] = [];
  for (const t of tickets) (t.liability === undefined || approved.has(norm(t.liability)) ? build : calls).push(t);
  return { build, calls };
}
