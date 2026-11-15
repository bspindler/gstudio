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
/** Cuts a title to MAX_TITLE at the last word break, with an ellipsis. */
export function shortTitle(title: string): string {
  if (title.length <= MAX_TITLE) return title;
  const cut = title.slice(0, MAX_TITLE - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > MAX_TITLE / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·-]+$/, '')}…`;
}
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
  /\bblock-barn\/(?:recorder\.js|audio\b)/i,
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

// "No hal hook change" / "without touching the hal hook" / "the hal hook stays untouched" say the ticket leaves the
// hook alone: drop those phrases before the protected check (it rejected the weathervane twice for saying so). The
// hal-hook tripwire still rejects any build that really edits the block. Only within one clause (no , . ; or newline).
const HOOK_DENIALS = [
  /\b(?:no|not|never|without|don'?t|do not|doesn'?t|does not|leaves?|leaving|avoids?|avoiding)\b[^.;,\n]{0,30}?\bhal hook\b/gi,
  /\bhal hook\b[^.;,\n]{0,12}?\b(?:stays|is left|remains|untouched|unchanged|alone)\b/gi,
];
const withoutHookDenials = (s: string) => HOOK_DENIALS.reduce((x, re) => x.replace(re, ' '), s);

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
    // A long title is shortened at a word, never a reason to lose the ticket (it lost Hyperline work twice).
    const k = { ...(raw as Record<string, unknown>) };
    if (typeof k.title === 'string' && k.title.trim().length > MAX_TITLE) k.title = shortTitle(k.title.trim());
    const str = (f: string) => typeof k[f] === 'string' && (k[f] as string).trim() !== '';
    for (const f of ['id', 'game', 'title', 'why']) if (!str(f)) errors.push(`${f} must be a non-empty string`);
    for (const f of ['target', 'liability', 'fromNote']) if (k[f] !== undefined && !str(f)) errors.push(`${f} must be a non-empty string when present`);
    if (typeof k.kind !== 'string' || !KINDS.includes(k.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
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
    if (PROTECTED.some((re) => re.test(withoutHookDenials(text)))) errors.push('touches a protected area by its own description');
    else if (k.liability === undefined && LIABILITY.some((re) => re.test(text))) errors.push('looks like a liability item (dependency, host, money); set "liability"');
    if (errors.length) {
      rejected.push({ index: i + 1, ...(str('id') ? { id: k.id as string } : {}), ...(typeof k.title === 'string' ? { title: k.title } : {}), reasons: errors });
      return;
    }
    ids.add(k.id as string);
    titles.add(norm(k.title as string));
    out.push(k as unknown as Ticket);
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
