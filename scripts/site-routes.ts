// Routes of the dev server's shelf site that are worth testing without starting the whole server.
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

/** The shelf page's bundled fonts (SIL OFL, see scripts/site/fonts/SOURCES.md). '_site' can't clash with a game slug. `scriptsRoot` is scripts/ relative to the cwd. */
export function mountSiteFonts(site: Hono, scriptsRoot: string): void {
  site.use('/_site/fonts/*', serveStatic({ root: scriptsRoot, rewriteRequestPath: (p) => p.replace(/^\/_site/, '/site') }));
}
