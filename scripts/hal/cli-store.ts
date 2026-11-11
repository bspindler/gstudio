// CLI commands over Hal's stored state: tell, notes, approve, spend. One handler per command; cli.ts only dispatches here.
import { parseArgs } from 'node:util';
import { DAILY_CAP_USD, apiSpent, dayOf, type SpendDay } from '@studio/core/hal';
import { createStore } from './store.js';

export type StoreCmdDeps = { halDir: string; now?: () => Date; games: string[] };
export const STORE_COMMANDS = ['tell', 'notes', 'approve', 'spend'] as const;
type StoreCommand = (typeof STORE_COMMANDS)[number];
const usd = (n: number) => `$${n.toFixed(2)}`;

type Opts = Record<string, { type: 'string' }>;
/** Throws Error with the message to show; cli.ts turns that into exit 1. */
function args(rest: string[], options: Opts) {
  return parseArgs({ args: rest, allowPositionals: true, options });
}

async function tell(rest: string[], d: StoreCmdDeps) {
  const { values, positionals } = args(rest, { game: { type: 'string' } });
  const text = positionals.join(' ').trim();
  if (!text) throw new Error('usage: hal tell "<text>" [--game <slug>]');
  const game = (values.game as string | undefined) ?? null;
  if (game !== null && !d.games.includes(game)) throw new Error(`unknown game ${game}; known: ${d.games.join(', ')}`);
  const n = await createStore(d).addNote({ text, game });
  console.log(`noted ${n.id}${game ? ` (${game})` : ''}`);
  return 0;
}

async function notes(rest: string[], d: StoreCmdDeps) {
  const { values } = args(rest, { clear: { type: 'string' } });
  const store = createStore(d);
  if (values.clear !== undefined) {
    if (!(await store.clearNote(values.clear as string))) throw new Error(`no note ${values.clear}`);
    console.log(`cleared ${values.clear}`);
    return 0;
  }
  const all = await store.readNotes();
  if (!all.length) console.log('no notes');
  for (const n of all) console.log(`${n.id} [${n.status}] (${n.game ?? 'any game'}) ${n.text}${n.reply ? `\n  reply: ${n.reply}` : ''}`);
  return 0;
}

async function approve(rest: string[], d: StoreCmdDeps) {
  const { positionals } = args(rest, {});
  const item = positionals.join(' ').trim();
  if (!item) throw new Error('usage: hal approve "<item, exactly as named in the report>"');
  const a = await createStore(d).addApproval(item);
  console.log(`approved: ${a.item}`);
  return 0;
}

const sums = (day: SpendDay) => ({
  api: apiSpent(day),
  sub: day.calls.filter((c) => c.billing === 'subscription').reduce((s, c) => s + Math.round(c.usd * 100), 0) / 100,
});

async function spend(rest: string[], d: StoreCmdDeps) {
  args(rest, {});
  const now = (d.now ?? (() => new Date()))();
  const store = createStore(d);
  const today = await store.loadSpendToday();
  const t = sums(today);
  console.log(`today (${today.day}): api ${usd(t.api)} of ${usd(DAILY_CAP_USD)} cap, subscription ${usd(t.sub)}`);
  const first = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const week = (await store.readSpend()).filter((x) => x.day >= first && x.day <= today.day);
  console.log('last 7 days:');
  for (const day of week) {
    const s = sums(day);
    console.log(`${day.day}  api ${usd(s.api)}  subscription ${usd(s.sub)}`);
  }
  return 0;
}

const handlers: Record<StoreCommand, (rest: string[], d: StoreCmdDeps) => Promise<number>> = { tell, notes, approve, spend };

export const isStoreCommand = (c: string | undefined): c is StoreCommand => !!c && (STORE_COMMANDS as readonly string[]).includes(c);
export const runStoreCommand = (c: StoreCommand, rest: string[], d: StoreCmdDeps) => handlers[c](rest, d);
