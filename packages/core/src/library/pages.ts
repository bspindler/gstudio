// HTML transforms for the GitHub Pages test-build site: hidden from search engines, collects nothing,
// and every game is labelled as a test build.
import type { GameMeta } from './load.js';

const NOINDEX = '<meta name="robots" content="noindex">';
const NO_INGEST = "<script>window.STUDIO_CONFIG={endpoint:''}</script>";
const BADGE =
  '<div id="studio-test-badge" style="position:fixed;right:8px;bottom:8px;z-index:2147483647;padding:4px 10px;' +
  'border-radius:999px;background:#000c;color:#fff;font:600 12px sans-serif;pointer-events:none">test build</div>';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Adds noindex, the no-ingest config (before any game script) and the corner badge. Idempotent. */
export function pagesGameHtml(html: string): string {
  let out = html;
  if (!out.includes('id="studio-test-badge"')) {
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => `${BADGE}</body>`) : out + BADGE;
  }
  // Each insert has its own guard, so a game that already has one of them still gets the others.
  const head = (out.includes(NOINDEX) ? '' : NOINDEX) + (out.includes(NO_INGEST) ? '' : NO_INGEST);
  if (head) {
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + head) : head + out;
  }
  return out;
}

export function pagesIndexHtml(games: GameMeta[]): string {
  const items = games.map((g) => `<li><a href="./${g.slug}/">${escapeHtml(g.title)}</a></li>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${NOINDEX}
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Test builds</title></head>
<body style="font:16px sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>Test builds</h1>
<p>These are test builds of games in progress, and nothing is collected from your play.</p>
<ul>
${items}
</ul>
</body></html>
`;
}
