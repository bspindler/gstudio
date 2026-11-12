// Real-browser regression: report forms must POST successfully (HAL_BROWSER=1 npx vitest run --project hal-browser).
// The unit tests set Origin by hand; a <meta name="referrer" content="no-referrer"> made real browsers send "Origin: null" and every form 403'd.
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServerApp } from './server.js';

const TOKEN = 'tok-' + 'b'.repeat(40);
const RUN = 'run-2026-11-12T08-00-00-000Z';
let halDir: string, browser: Browser, server: ReturnType<typeof serve>, origin: string;

beforeAll(async () => {
  halDir = await mkdtemp(join(tmpdir(), 'hal-forms-'));
  const dir = join(halDir, 'runs', RUN);
  await mkdir(dir, { recursive: true });
  const sr = (fitness: number) => ({ game: 'g', levels: [], measures: {}, fitness, hardFailures: [] });
  await writeFile(join(dir, 'report.json'), JSON.stringify({
    runId: RUN, night: '2026-11-11', startedAt: '2026-11-12T08:00:00Z', endedAt: '2026-11-12T09:30:00Z',
    trigger: 'nightly', billing: 'api', billingEnded: 'api', spend: { api: 1.25, subscription: 0 },
    games: { gearhold: { before: { gearhold: 80 }, after: { gearhold: 90 }, measures: {} } },
    changes: [{
      pass: 'HAL-003', ticket: { id: 'T1', game: 'gearhold', kind: 'tuning', title: 'Kiln Heart is fairer', why: 'why' }, verdict: 'merged', reasons: [],
      scoresBefore: { gearhold: sr(70) }, scoresAfter: { gearhold: sr(80) }, costUsd: 0.5, commit: 'a'.repeat(40), version: '0.2.1', changelog: 'Fairer.', shots: {},
    }],
    calls: [], planned: [], notes: [], pushed: true, warnings: [],
  }));
  await writeFile(join(dir, 'note.md'), `# Hal, night of 2026-11-11 (${RUN})\n\nOne pass merged.\n`);
  await writeFile(join(halDir, 'latest.json'), JSON.stringify({ runId: RUN, endedAt: '2026-11-12T09:30:00Z', reportMd: join(dir, 'report.md') }));
  const app = createServerApp({
    halDir, token: TOKEN, games: ['gearhold'], now: () => new Date('2026-11-12T10:00:00Z'),
    isAlive: () => false, startTimeOf: () => null, spawnRun: () => {}, devUrl: async () => null,
  });
  await new Promise<void>((res) => { server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => res()); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((res) => server?.close(res));
  await rm(halDir, { recursive: true, force: true });
});

describe('report forms in a real browser', () => {
  it('Keep POSTs /vote with a real Origin (not 403) and the vote lands in feedback.json', async () => {
    const page = await browser.newPage();
    const statuses: { url: string; status: number; origin: string | undefined }[] = [];
    page.on('response', async (r) => {
      if (r.request().method() === 'POST') statuses.push({ url: r.url(), status: r.status(), origin: (await r.request().allHeaders()).origin });
    });
    await page.goto(`${origin}/?t=${TOKEN}`);
    const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/vote'));
    await page.getByRole('button', { name: /Keep/ }).first().click();
    await sent;
    const post = statuses.find((s) => s.url.endsWith('/vote'));
    expect(post, 'a POST /vote was sent').toBeDefined();
    expect(post!.origin).toBe(origin);
    expect(post!.status).not.toBe(403);
    const fb = JSON.parse(await readFile(join(halDir, 'feedback.json'), 'utf8')) as { votes: { pass: string; vote: string }[] };
    expect(fb.votes).toMatchObject([{ item: 'HAL-003', vote: 'up' }]);
    await page.close();
  });
});
