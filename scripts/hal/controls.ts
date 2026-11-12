/// <reference lib="dom" />
// Real-input controls check: proves the games still answer real keyboard, mouse and touch events. The play robot
// (gearhold-play.ts) sets input state through the hook; this drives the real input paths instead.
// Gearhold runs in ?hal=<seed>&live mode (its own rAF loop runs update() with real input; we only *read* state()).
// Touch drags go through CDP Input.dispatchTouchEvent, which Chromium turns into pointer events with
// pointerType 'touch' (page.mouse would send pointerType 'mouse' even in a touch context).
// Tidepool and Hyperline have no hook: one real primary action each, with a screenshot diff and a DOM check.
import type { Browser, BrowserContextOptions, CDPSession, Locator, Page } from 'playwright';
import { closeAll, launchBrowser, newHalContext, serveGames, type StaticServer } from './browser.js';

export type ControlCheck = { game: string; check: string; ok: boolean; detail: string; skipped?: string };
export type ControlsOptions = {
  /** Runs in every page before the game's own scripts (tests use it to break an input path on purpose). */
  initScript?: string;
  /** Limits the run to these games (default: all). */
  games?: string[];
};

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const HOLD_S = 0.3, SETTLE_S = 0.3; // game (sim) seconds, so a slow or loaded machine still gets the full hold

type Errors = { pageErrors: string[]; consoleErrors: string[]; blocked: string[] };
type P = { x: number; y: number; a: number; look: number; weapon: number };
type St = { mode: string; time: number; p: P; shotsFired: number };

const f = (n: number) => n.toFixed(3);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const state = (page: Page): Promise<St> => page.evaluate(() => (window as any).__hal.state());
/** Waits until Gearhold's own rAF loop has advanced the level clock by secs (live mode runs update() per frame). */
async function sim(page: Page, secs: number) {
  const t0 = (await state(page)).time;
  await page.waitForFunction(([t0, secs]) => (window as any).__hal.state().time >= t0! + secs!, [t0, secs], { timeout: 15_000 });
}
/** Screenshots el until it differs from before (up to ms); returns the last shot. */
async function changed(el: Locator, before: Buffer, ms = 3_000): Promise<Buffer> {
  const end = Date.now() + ms;
  for (;;) {
    const shot = await el.screenshot();
    if (!shot.equals(before) || Date.now() > end) return shot;
    await wait(100);
  }
}
/** Displacement from a to b split into along the facing at a (cos a, sin a) and to its right (-sin a, cos a). */
function moved(a: St, b: St) {
  const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, c = Math.cos(a.p.a), s = Math.sin(a.p.a);
  return { along: dx * c + dy * s, right: -dx * s + dy * c };
}

class Run {
  checks: ControlCheck[] = [];
  constructor(readonly browser: Browser, readonly origin: string, readonly opts: ControlsOptions) {}
  add(game: string, check: string, ok: boolean, detail: string) { this.checks.push({ game, check, ok, detail }); }
  skip(game: string, check: string, skipped: string, detail = '') { this.checks.push({ game, check, ok: true, detail, skipped }); }

  /**
   * Opens a page in a fresh newHalContext: no outbound requests (non-loopback and other local ports are refused
   * and listed in blocked). errors holds page errors; consoleErrors (live) holds console.error minus the
   * load failures of blocked requests.
   */
  async open(contextOptions: BrowserContextOptions, path: string) {
    const { context, blockedRequests: blocked, consoleErrors } = await newHalContext(this.browser, { contextOptions });
    if (this.opts.initScript) await context.addInitScript(this.opts.initScript);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${this.origin}${path}`);
    return { context, page, errors: { pageErrors, consoleErrors, blocked } };
  }

  /** Runs one game's block; a throw becomes a failed check, so one broken game never hides the others. */
  async guard(game: string, label: string, fn: () => Promise<void>) {
    try { await fn(); } catch (e) { this.add(game, label, false, `threw: ${String((e as Error)?.message ?? e).split('\n')[0]}`); }
  }
  /**
   * Two checks per game and context: no page or console errors, and no outbound requests. Fonts are bundled, so
   * any request newHalContext had to block is a failure for every game; the detail lists them.
   */
  noErrors(game: string, e: Errors) {
    const all = [...e.pageErrors, ...e.consoleErrors.map((m) => `console: ${m}`)];
    this.add(game, 'no page errors', all.length === 0, all.length ? all.slice(0, 3).join(' | ') : 'none');
    const blocked = [...new Set(e.blocked)];
    this.add(game, 'no outbound requests', blocked.length === 0, blocked.length ? `blocked (${e.blocked.length}): ${blocked.join(', ')}` : 'blocked requests: none');
  }
}

/** Starts Gearhold level index 0 (shown as level 1 in the UI) with a real click or tap on the overlay's first level button. */
async function startGearhold(page: Page, touch: boolean): Promise<St> {
  const btn = page.locator('#levels button').first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  if (touch) await btn.tap(); else await btn.click();
  await page.waitForFunction(() => (window as any).__hal?.state().mode === 'play', undefined, { timeout: 5_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.()); // Space must not re-click it
  await wait(200);
  return state(page);
}

async function gearholdKeyboard(run: Run) {
  const G = 'gearhold', { context, page, errors } = await run.open(DESKTOP, '/gearhold/index.html?hal=1&live');
  try {
    await startGearhold(page, false);
    const hold = async (key: string) => {
      const a = await state(page);
      await page.keyboard.down(key); await sim(page, HOLD_S); await page.keyboard.up(key); await sim(page, SETTLE_S);
      return { a, b: await state(page) };
    };
    const move = async (key: string, want: 'fwd' | 'back' | 'right' | 'left') => {
      const { a, b } = await hold(key), m = moved(a, b);
      const main = want === 'fwd' ? m.along : want === 'back' ? -m.along : want === 'right' ? m.right : -m.right;
      const off = want === 'fwd' || want === 'back' ? m.right : m.along;
      run.add(G, `key ${key} moves ${want}`, main > 0.2 && Math.abs(off) < main * 0.5,
        `along facing ${f(m.along)}, to the right ${f(m.right)} (a=${f(a.p.a)})`);
    };
    await move('KeyW', 'fwd');
    await move('KeyS', 'back');
    await move('ArrowUp', 'fwd');
    await move('ArrowDown', 'back');
    await move('KeyD', 'right');
    await move('KeyA', 'left');
    for (const [key, sign] of [['ArrowLeft', -1], ['ArrowRight', 1]] as const) {
      const { a, b } = await hold(key), da = b.p.a - a.p.a;
      run.add(G, `key ${key} turns ${sign < 0 ? 'left' : 'right'}`, da * sign > 0.2, `delta a ${f(da)}`);
    }
    {
      const { a, b } = await hold('Space');
      run.add(G, 'key Space fires', b.shotsFired > a.shotsFired, `shotsFired ${a.shotsFired} -> ${b.shotsFired}`);
    }
    {
      // Precondition only: own the scatter cannon (its pickup is deep in every level). The key presses stay real.
      await page.evaluate(() => (window as any).__hal.grant('scatter', 8));
      const w0 = (await state(page)).p.weapon;
      await page.keyboard.press('Digit2'); await sim(page, 0.05);
      const w2 = (await state(page)).p.weapon;
      await page.keyboard.press('Digit1'); await sim(page, 0.05);
      const w1 = (await state(page)).p.weapon;
      run.add(G, 'keys Digit2 / Digit1 swap weapon (scatter granted)', w0 === 0 && w2 === 1 && w1 === 0, `weapon ${w0} -Digit2-> ${w2} -Digit1-> ${w1}`);
    }

    // Mouse look needs pointer lock on #view; the level button click already asked for it.
    let locked = await page.evaluate(() => document.pointerLockElement?.id ?? '');
    if (locked !== 'view') {
      await page.mouse.click(640, 400); // a real click on the stage calls lockPointer()
      await wait(200);
      locked = await page.evaluate(() => document.pointerLockElement?.id ?? '');
    }
    if (locked !== 'view') run.skip(G, 'mouse look', 'pointer lock unavailable headless', `pointerLockElement=${locked || 'null'}`);
    else {
      const a = await state(page);
      await page.mouse.move(640, 400);
      for (let i = 1; i <= 10; i++) { await page.mouse.move(640 + i * 20, 400 - i * 5); await wait(16); }
      await sim(page, 0.15);
      const b = await state(page), da = b.p.a - a.p.a, dl = b.p.look - a.p.look;
      run.add(G, 'mouse look turns and pitches', da > 0.1 && dl > 0.01, `delta a ${f(da)}, delta look ${f(dl)}`);
    }
  } finally {
    run.noErrors(`${G} (desktop)`, errors);
    await context.close();
  }
}

/** Real touch through CDP: Chromium dispatches pointer events with pointerType 'touch' from these. */
async function touchDrag(cdp: CDPSession, path: [number, number][], hold: () => Promise<void>, during?: () => Promise<void>) {
  const [x0, y0] = path[0]!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (const [x, y] of path.slice(1)) {
    await wait(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await hold();
  await during?.();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function center(page: Page, sel: string): Promise<[number, number]> {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} not visible`);
  return [b.x + b.width / 2, b.y + b.height / 2];
}

async function gearholdTouch(run: Run) {
  const G = 'gearhold', { context, page, errors } = await run.open(PHONE, '/gearhold/index.html?hal=1&live');
  try {
    const cdp = await context.newCDPSession(page);
    await startGearhold(page, true);
    await page.evaluate(() => {
      (window as any).__ptypes = [];
      document.getElementById('stage')!.addEventListener('pointerdown', (e) => (window as any).__ptypes.push(e.pointerType), true);
    }); // observe only: records which pointerType the game's stage saw
    const visible = (id: string) => page.evaluate((id) => document.getElementById(id)!.checkVisibility(), id); // honours a hidden #touchui parent
    const W = 390;

    // stick: drag up on the left half, hold, release
    {
      const a = await state(page);
      let shown = false, knobMoved = false;
      await touchDrag(cdp, [[95, 620], [95, 600], [95, 580], [95, 560]], () => sim(page, 0.4), async () => {
        shown = (await visible('stick')) && (await visible('knob'));
        knobMoved = await page.evaluate(() => document.getElementById('knob')!.style.top !== document.getElementById('stick')!.style.top);
      });
      await sim(page, SETTLE_S);
      const b = await state(page), m = moved(a, b);
      const hidden = !(await visible('stick')) && !(await visible('knob'));
      run.add(G, 'touch stick (left half drag) moves forward', m.along > 0.2 && Math.abs(m.right) < m.along * 0.5,
        `along facing ${f(m.along)}, to the right ${f(m.right)}`);
      run.add(G, 'touch stick and knob show while dragging, hide on release', shown && knobMoved && hidden,
        `shown=${shown} knobMoved=${knobMoved} hiddenAfter=${hidden}`);
    }
    // look: drag right and up on the right half
    {
      const a = await state(page);
      await touchDrag(cdp, [[W * 0.7, 320], [W * 0.7 + 10, 315], [W * 0.7 + 20, 310], [W * 0.7 + 30, 305], [W * 0.7 + 40, 300]], () => sim(page, 0.05));
      await sim(page, 0.1);
      const b = await state(page), da = b.p.a - a.p.a, dl = b.p.look - a.p.look;
      run.add(G, 'touch look (right half drag) changes a and look', da > 0.1 && dl > 0.03, `delta a ${f(da)}, delta look ${f(dl)}`);
    }
    // fire
    {
      const a = await state(page), [x, y] = await center(page, '#fire');
      await touchDrag(cdp, [[x, y]], () => sim(page, 0.1));
      await sim(page, 0.1);
      const b = await state(page);
      run.add(G, 'touch tap #fire fires', b.shotsFired > a.shotsFired, `shotsFired ${a.shotsFired} -> ${b.shotsFired}`);
    }
    // swap without the scatter cannon: the message, and no weapon change
    {
      const a = await state(page), [x, y] = await center(page, '#swap');
      await touchDrag(cdp, [[x, y]], () => wait(80));
      await wait(100);
      const b = await state(page);
      const msg = await page.evaluate(() => { const m = document.getElementById('msg')!; return m.hidden ? '' : m.textContent ?? ''; });
      run.add(G, 'touch tap #swap without scatter says so', msg === 'No second weapon yet.' && b.p.weapon === a.p.weapon,
        `msg=${JSON.stringify(msg)} weapon ${a.p.weapon} -> ${b.p.weapon}`);
    }
    // with the scatter cannon (granted as a precondition; the taps stay real): each SWAP tap toggles
    {
      await page.evaluate(() => (window as any).__hal.grant('scatter', 8));
      const [x, y] = await center(page, '#swap'), w0 = (await state(page)).p.weapon;
      await touchDrag(cdp, [[x, y]], () => wait(80)); await sim(page, 0.05);
      const w1 = (await state(page)).p.weapon;
      await touchDrag(cdp, [[x, y]], () => wait(80)); await sim(page, 0.05);
      const w2 = (await state(page)).p.weapon;
      run.add(G, 'touch tap #swap toggles weapon (scatter granted)', w0 === 0 && w1 === 1 && w2 === 0, `weapon ${w0} -tap-> ${w1} -tap-> ${w2}`);
    }
    const types = await page.evaluate(() => (window as any).__ptypes as string[]);
    run.add(G, 'touch events reach the game as pointerType touch', types.length > 0 && types.every((t) => t === 'touch'),
      `stage pointerdown types: ${[...new Set(types)].join(',') || 'none'} (${types.length})`);
  } finally {
    run.noErrors(`${G} (touch)`, errors);
    await context.close();
  }
}

async function tidepool(run: Run) {
  const G = 'tidepool-pals', { context, page, errors } = await run.open(PHONE, '/tidepool-pals/index.html');
  try {
    const start = page.locator('[data-act="start"]').first();
    await start.waitFor({ state: 'visible', timeout: 15_000 });
    await start.tap();
    await page.locator('#tiles .tile').first().waitFor({ state: 'visible', timeout: 5_000 });
    await wait(800); // entry animation
    const before = await page.locator('#board').screenshot();
    const moves = () => page.locator('#movesCount').textContent();
    const m0 = await moves();
    const n = await page.locator('#tiles .tile').count();
    let m1 = m0, tapped = -1;
    for (let i = 0; i < Math.min(n, 40) && m1 === m0; i++) {
      const b = await page.locator('#tiles .tile').nth(i).boundingBox();
      if (!b) continue;
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await wait(60);
      m1 = await moves(); tapped = i;
      if (m1 === m0) await wait(250); // an invalid tap only shakes the tile
    }
    await wait(900); // pops, collapse and refill
    const after = await changed(page.locator('#board'), before);
    const m2 = await moves(); // re-read once the move has settled: the move must have stuck
    const ok = m0 !== null && m2 !== null && Number(m2) < Number(m0);
    run.add(G, 'touch tap on a tile group makes a move', ok, `moves ${m0} -> ${m1} (settled ${m2}) after tapping tile #${tapped} of ${n}`);
    run.add(G, 'board screenshot changes after the move', !before.equals(after), `${before.length} vs ${after.length} bytes`);
  } finally {
    run.noErrors(G, errors);
    await context.close();
  }
}

/** Polls until Hyperline's run has started (ready overlay hidden, pause button shown), up to ms. */
async function runStarted(page: Page, ms = 5_000): Promise<boolean> {
  return page.waitForFunction(() => document.getElementById('ready')!.hidden && !document.getElementById('pauseBtn')!.hidden, undefined, { timeout: ms })
    .then(() => true, () => false);
}

async function hyperline(run: Run) {
  const G = 'hyperline';
  {
    const { context, page, errors } = await run.open(PHONE, '/hyperline/index.html');
    try {
      const go = page.locator('#ready .go');
      await go.waitFor({ state: 'visible', timeout: 15_000 });
      await wait(300);
      const canvas = page.locator('#game');
      const before = await canvas.screenshot();
      const [x, y] = await center(page, '#ready .go');
      await page.touchscreen.tap(x, y);
      const started = await runStarted(page);
      run.add(G, 'touch tap starts the run', started, `ready hidden and pause shown: ${started}`);
      const mid = await changed(canvas, before);
      run.add(G, 'canvas changes after the start tap', !before.equals(mid), `${before.length} vs ${mid.length} bytes`);
      // Hyperline exposes no DOM or state signal for a jump (only a sound and canvas particles), so this checks
      // only that a tap during the run is accepted: no page error, and the run is still going.
      const errs0 = errors.pageErrors.length;
      await page.touchscreen.tap(x, y);
      await wait(300);
      const still = await runStarted(page, 1_000);
      run.add(G, 'tap during the run is accepted without error (no jump signal exposed)', still && errors.pageErrors.length === errs0,
        `still running: ${still}, new page errors: ${errors.pageErrors.length - errs0}`);
    } finally {
      run.noErrors(`${G} (touch)`, errors);
      await context.close();
    }
  }
  {
    const { context, page, errors } = await run.open(DESKTOP, '/hyperline/index.html');
    try {
      await page.locator('#ready .go').waitFor({ state: 'visible', timeout: 15_000 });
      await wait(300);
      const canvas = page.locator('#game');
      const before = await canvas.screenshot();
      await page.keyboard.press('Space');
      const started = await runStarted(page);
      const after = await changed(canvas, before);
      run.add(G, 'key Space starts the run (desktop)', started, `ready hidden and pause shown: ${started}`);
      run.add(G, 'canvas changes after Space (desktop)', !before.equals(after), `${before.length} vs ${after.length} bytes`);
    } finally {
      run.noErrors(`${G} (desktop)`, errors);
      await context.close();
    }
  }
}

/**
 * Runs every controls check against the local games/ folder. Never throws for a game failure (that is a failed
 * check); throws "browser unavailable: ..." from launchBrowser when no WebGL 2 Chromium can start.
 */
export async function runControlsCheck(opts: ControlsOptions = {}): Promise<ControlCheck[]> {
  let server: StaticServer | undefined, browser: Browser | undefined;
  try {
    server = await serveGames();
    browser = await launchBrowser();
    const run = new Run(browser, server.origin, opts);
    const want = (g: string) => !opts.games || opts.games.includes(g);
    if (want('gearhold')) await run.guard('gearhold', 'keyboard (desktop)', () => gearholdKeyboard(run));
    if (want('gearhold')) await run.guard('gearhold', 'touch (390x844)', () => gearholdTouch(run));
    if (want('tidepool-pals')) await run.guard('tidepool-pals', 'touch tile tap', () => tidepool(run));
    if (want('hyperline')) await run.guard('hyperline', 'tap and key', () => hyperline(run));
    return run.checks;
  } finally {
    await closeAll(browser, server);
  }
}
