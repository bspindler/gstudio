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
export type TicketResult = { ok: true; tickets: Ticket[] } | { ok: false; errors: string[] };

export const MAX_TICKETS = 8;
export const MAX_TITLE = 80;
const KINDS: readonly string[] = ['fix', 'tuning', 'polish', 'feature'];

const EDIT = '(?:edit|change|modify|update|loosen|relax|tweak|rewrite|disable|skip|bypass|remove|delete|weaken|patch|touch|replace)';
// Heuristic: a verb aimed at Hal's own machinery, or a path that is protected. Errs toward rejecting; the planner can rephrase.
const PROTECTED: RegExp[] = [
  new RegExp(`\\b${EDIT}\\b[^.;\\n]{0,24}\\b(?:score|scores|scorer|scorers|scoring|tripwires?|gate|baseline|ledger|compliance|policy|gateway)\\b`, 'i'),
  /\b(?:policy|markets)\.yaml\b/i,
  /\bCLAUDE\.md\b/,
  /\.hal\.env\b/,
  /(?:^|[\s`'"(])(?:scripts\/hal(?:\.ts|\/)|packages\/core\/src\/hal|packages\/core\/test\/hal-|infra\/|\.github\/|\.data\/|docs\/superpowers)/,
  /\bgearhold\/levels\.d\.ts\b/,
  /\bhal hook\b/i,
];
// Heuristic: text that reads like a dependency, a new host or money, but carries no `liability` field.
const LIABILITY: RegExp[] = [
  /\bcdn\b/i, /\bnpm (?:install|i)\b/i, /\b(?:add|install|import|use)\b[^.;\n]{0,20}\b(?:dependency|dependencies|library|package|framework|engine)\b/i,
  /\bpackage(?:-lock)?\.json\b/i, /\banalytics\b/i, /\bhttps?:\/\//i, /\b(?:iap|in-app purchase|purchase code|prices?|pricing)\b/i,
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
  const errors: string[] = [];
  if (list.length > MAX_TICKETS) errors.push(`more than ${MAX_TICKETS} tickets (${list.length})`);
  const ids = new Set<string>(), titles = new Set<string>();
  const out: Ticket[] = [];
  list.forEach((raw, i) => {
    const at = `ticket ${i + 1}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { errors.push(`${at}: not an object`); return; }
    const k = raw as Record<string, unknown>;
    const str = (f: string) => typeof k[f] === 'string' && (k[f] as string).trim() !== '';
    for (const f of ['id', 'game', 'title', 'why']) if (!str(f)) errors.push(`${at}: ${f} must be a non-empty string`);
    for (const f of ['target', 'liability', 'fromNote']) if (k[f] !== undefined && !str(f)) errors.push(`${at}: ${f} must be a non-empty string when present`);
    if (typeof k.kind !== 'string' || !KINDS.includes(k.kind)) errors.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (typeof k.title === 'string' && k.title.length > MAX_TITLE) errors.push(`${at}: title is over ${MAX_TITLE} characters`);
    if (str('id')) { if (ids.has(k.id as string)) errors.push(`${at}: duplicate id ${k.id}`); ids.add(k.id as string); }
    if (str('title')) { const n = norm(k.title as string); if (titles.has(n)) errors.push(`${at}: duplicate title "${k.title}"`); titles.add(n); }
    if (str('game')) {
      if (!games.includes(k.game as string)) errors.push(`${at}: unknown game ${k.game}`);
      else if (str('target') && !(Object.hasOwn(measures, k.game as string) && measures[k.game as string]!.includes(k.target as string))) {
        errors.push(`${at}: unknown measure ${k.target} for ${k.game}`);
      }
    }
    const text = `${k.title ?? ''}\n${k.why ?? ''}`;
    if (PROTECTED.some((re) => re.test(text))) errors.push(`${at}: touches a protected area by its own description`);
    else if (k.liability === undefined && LIABILITY.some((re) => re.test(text))) errors.push(`${at}: looks like a liability item (dependency, host, money); set "liability"`);
    out.push(raw as Ticket);
  });
  return errors.length ? { ok: false, errors } : { ok: true, tickets: out };
}

/** Liability tickets with no matching approval become `calls` (asked in the report); the rest are built, liability field kept. */
export function splitLiability(tickets: Ticket[], approvals: Approval[]): { build: Ticket[]; calls: Ticket[] } {
  const approved = new Set(approvals.map((a) => norm(a.item)));
  const build: Ticket[] = [], calls: Ticket[] = [];
  for (const t of tickets) (t.liability === undefined || approved.has(norm(t.liability)) ? build : calls).push(t);
  return { build, calls };
}
