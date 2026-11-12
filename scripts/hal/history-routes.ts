// The shelf's History routes: /_history/<game>, /_history/<game>/<pass>, and committed images. Mounted before the static `/*`.
import type { Context } from 'hono';
import type { Hono } from 'hono';
import type { HistoryFilter } from '@studio/core/hal';
import { filterHistory } from '@studio/core/hal';
import { readGameHistory, readHistoryImage } from './history-git.js';
import { renderHistory } from './history-page.js';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'";
const KINDS = ['fix', 'tuning', 'polish', 'feature', 'brian'] as const;

export function mountHistory(site: Hono, o: { repo: string; games: Array<{ slug: string; title: string }> }): void {
  const find = (slug: string) => o.games.find((g) => g.slug === slug);
  const notFound = (c: Context) => c.text('Not found', 404, { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
  const page = async (c: Context, slug: string, focus?: string) => {
    const game = find(slug);
    if (!game) return notFound(c);
    const h = await readGameHistory(o.repo, game.slug);
    if (focus && !h.nights.some((n) => n.entries.some((e) => e.type === 'hal' && e.pass === focus))) return notFound(c);
    const q = c.req.query();
    const filter: HistoryFilter = {};
    if (q.q?.trim()) filter.q = q.q.trim().slice(0, 200);
    const kind = KINDS.find((k) => k === q.kind);
    if (kind) filter.kind = kind;
    if (q.status === 'kept' || q.status === 'undone') filter.status = q.status;
    const nights = focus ? h.nights : filterHistory(h.nights, filter);
    return c.html(renderHistory({ game: game.slug, title: game.title, nights, notes: h.notes, scores: h.scores, filter, ...(focus ? { focus } : {}) }), 200, { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
  };
  site.get('/_history/:game', (c) => page(c, c.req.param('game')));
  site.get('/_history/:game/img/:night/:file', async (c) => {
    const { game, night, file } = c.req.param();
    if (!find(game)) return notFound(c);
    const bytes = await readHistoryImage(o.repo, game, night, file);
    if (!bytes) return notFound(c);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg', 'Content-Security-Policy': CSP, 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  });
  site.get('/_history/:game/:pass', (c) => (/^HAL-\d+$/.test(c.req.param('pass')) ? page(c, c.req.param('game'), c.req.param('pass')) : notFound(c)));
}
