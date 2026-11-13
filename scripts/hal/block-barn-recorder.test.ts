/// <reference lib="dom" />
// Block Barn's grown-up recordings (recorder.js) in a phone browser on 127.0.0.1, with Chromium's fake microphone
// (a beep) granted without a prompt. Speech is faked (it logs what was said and holds each line until released) and
// every <audio> play() is logged with its src, so "the recording played, not a clip or speech" can be checked.
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, launchBrowser, newHalContext, serveGames, type HalContext, type StaticServer } from './browser.js';

type Target = { kind: string; letter?: string; x: number; y: number; w: number; h: number };

let server: StaticServer, browser: Browser;
const opened: HalContext[] = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

beforeAll(async () => {
  server = await serveGames();
  browser = await launchBrowser({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
afterAll(async () => {
  for (const h of opened) await h.context.close().catch(() => {});
  await closeAll(browser, server);
});

function fakeSpeech(): void {
  const log: string[] = [];
  let hold = true;
  const pending: any[] = [];
  const plays: string[] = [];
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { plays.push(this.src); return realPlay.call(this); };
  const fake = {
    speak(u: any) {
      if (u.text.trim() === '') return; // the silent priming utterance
      log.push(u.text); pending.push(u); if (!hold) setTimeout(() => u.onend?.(), 10);
    },
    cancel() { pending.length = 0; },
    getVoices: () => [], addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
  (window as any).__fakeSpeech = { log, plays, release() { hold = false; for (const u of pending.splice(0)) u.onend?.(); } };
}

const denyMic = () => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
};
const breakIndexedDb = () => {
  Object.defineProperty(IDBFactory.prototype, 'open', { configurable: true, value() { throw new DOMException('no', 'InvalidStateError'); } });
};
// Keeps every microphone stream handed out, so a test can see its tracks end.
const watchMic = () => {
  const md = navigator.mediaDevices;
  const real = md.getUserMedia.bind(md);
  const w = window as any;
  w.__streams = [];
  md.getUserMedia = async (c?: MediaStreamConstraints) => { const st = await real(c); w.__streams.push(st); return st; };
};
// Every put aborts its transaction: the browser refuses to keep the recording.
const failPut = () => {
  const real = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: [unknown, IDBValidKey?]) { const r = real.apply(this, a); this.transaction.abort(); return r; };
};
// Counts IndexedDB transactions.
const countTx = () => {
  const real = IDBDatabase.prototype.transaction;
  const w = window as any;
  w.__tx = 0;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...a: any[]) { w.__tx++; return (real as any).apply(this, a); } as any;
};
const insecure = () => { Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false }); };

async function open(...init: (() => void)[]): Promise<{ page: Page; hal: HalContext }> {
  const hal = await newHalContext(browser, { contextOptions: PHONE });
  opened.push(hal);
  await hal.context.addInitScript(fakeSpeech);
  for (const s of init) await hal.context.addInitScript(s);
  const page = await hal.context.newPage();
  page.on('pageerror', (e) => hal.consoleErrors.push(String(e)));
  await goto(page);
  return { page, hal };
}
async function goto(page: Page): Promise<void> {
  await page.goto(`${server.origin}/block-barn/index.html?hal`);
  await page.waitForFunction(() => !!(window as any).__hal, null, { timeout: 5000 });
}

const targets = (page: Page): Promise<Target[]> => page.evaluate(() => (window as any).__hal.targets());
const said = (page: Page): Promise<string[]> => page.evaluate(() => [...(window as any).__fakeSpeech.log]);
const plays = (page: Page): Promise<string[]> => page.evaluate(() => [...(window as any).__fakeSpeech.plays]);
const release = (page: Page) => page.evaluate(() => (window as any).__fakeSpeech.release());
const voices = (page: Page) => page.locator('#voices');
const row = (page: Page, label: RegExp) => voices(page).getByRole('group', { name: label });

async function find(page: Page, kind: string, letter?: string): Promise<Target> {
  const t = (await targets(page)).find((x) => x.kind === kind && (letter === undefined || x.letter === letter));
  if (!t) throw new Error(`no ${kind} target${letter ? ` for ${letter}` : ''}`);
  return t;
}
async function tap(page: Page, t: Target) { await page.touchscreen.tap(t.x + t.w / 2, t.y + t.h / 2); }

async function seedWith(page: Page, letter: string): Promise<void> {
  for (let n = 1; n < 500; n++) {
    await page.evaluate((s) => (window as any).__hal.seed(s), n);
    if ((await page.evaluate(() => (window as any).__hal.state().floor as string[])).includes(letter)) return;
  }
  throw new Error(`no seed puts ${letter} on the floor`);
}

/** Holds the corner for 3 s with a real touch, which opens the grown-up corner. */
async function openCorner(page: Page): Promise<void> {
  const c = await find(page, 'corner');
  const at = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await page.waitForTimeout(3200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('dialog').isVisible()).resolves.toBe(true);
}
async function closeCorner(page: Page): Promise<void> {
  await page.getByRole('button', { name: /back to the barn/i }).tap();
}

/** The blob: URLs played so far whose recording is audio/webm (Chromium's own format; the priming WAV is not). */
async function playedRecordings(page: Page): Promise<string[]> {
  const srcs = (await plays(page)).filter((s) => s.startsWith('blob:'));
  return page.evaluate(async (list) => {
    const out: string[] = [];
    for (const s of list) {
      try {
        const b = await new Promise<Blob>((ok, no) => {
          const x = new XMLHttpRequest(); x.open('GET', s); x.responseType = 'blob';
          x.onload = () => ok(x.response); x.onerror = no; x.send();
        });
        if (b.type.startsWith('audio/webm') && b.size > 0) out.push(s);
      } catch { /* revoked */ }
    }
    return out;
  }, srcs);
}

/** Opens the corner, picks C and records "cow" for about a second; leaves it waiting for keep or redo. */
async function recordCow(page: Page): Promise<void> {
  await openCorner(page);
  await voices(page).getByRole('button', { name: 'C c', exact: true }).tap();
  const name = row(page, /name.*cow/i);
  await expect(name.getByText('Default voice').isVisible()).resolves.toBe(true);
  await name.getByRole('button', { name: /^record$/i }).tap();
  await name.getByRole('button', { name: /^stop$/i }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await name.getByRole('button', { name: /^stop$/i }).tap();
  try { await name.getByRole('button', { name: /^keep$/i }).waitFor({ timeout: 5000 }); } catch (e) {
    throw new Error(`no keep; the list says: ${await voices(page).innerText()}`);
  }
}

describe('block barn: grown-ups record their own voice', () => {
  it('records name-c, hears it back, keeps it; after a reload tapping C plays the recording, not a clip or speech', async () => {
    const { page, hal } = await open();
    await recordCow(page);
    const name = row(page, /name.*cow/i);
    await expect(name.getByRole('button', { name: /^redo$/i }).isVisible()).resolves.toBe(true);
    await name.getByRole('button', { name: /^hear it$/i }).tap();
    await expect.poll(() => playedRecordings(page), { timeout: 5000 }).toHaveLength(1);
    await name.getByRole('button', { name: /^keep$/i }).tap();
    await name.getByText(/your voice/i).waitFor({ timeout: 5000 });
    await expect(name.getByRole('button', { name: /back to default/i }).isVisible()).resolves.toBe(true);

    await goto(page);
    await seedWith(page, 'c');
    await tap(page, await find(page, 'block', 'c'));
    await expect.poll(() => said(page)).toEqual(['C.']);
    await release(page); // the letter is spoken, capital then small (no bundled clip yet); then the name is the recording
    await expect.poll(() => playedRecordings(page), { timeout: 5000 }).toHaveLength(1);
    await expect.poll(() => said(page), { timeout: 8000 }).toContain('moo'); // the noise follows once the recording ends
    expect(await said(page)).not.toContain('cow');
    expect((await plays(page)).filter((s) => /audio\/name-c/.test(s))).toEqual([]);
    expect(hal.blockedRequests).toEqual([]);
    expect(hal.consoleErrors).toEqual([]);
  });

  it('only one recording at a time, and it stops by itself after 6 s', async () => {
    const { page } = await open();
    await openCorner(page);
    await voices(page).getByRole('button', { name: 'C c', exact: true }).tap();
    const name = row(page, /name.*cow/i);
    await name.getByRole('button', { name: /^record$/i }).tap();
    await name.getByRole('button', { name: /^stop$/i }).waitFor({ timeout: 5000 });
    await expect(voices(page).getByRole('button', { name: /^record$/i }).count()).resolves.toBe(0);
    await name.getByRole('button', { name: /^keep$/i }).waitFor({ timeout: 8000 });
    await expect(voices(page).getByRole('button', { name: /^record$/i }).count()).resolves.toBeGreaterThan(0);
  });

  it('"back to default" removes the recording: after a reload C says "cow" in the device voice again', async () => {
    const { page, hal } = await open();
    await recordCow(page);
    const name = row(page, /name.*cow/i);
    await name.getByRole('button', { name: /^keep$/i }).tap();
    await name.getByRole('button', { name: /back to default/i }).tap();
    await name.getByText('Default voice').waitFor({ timeout: 5000 });
    await expect(name.getByRole('button', { name: /back to default/i }).count()).resolves.toBe(0);

    await goto(page);
    await seedWith(page, 'c');
    await tap(page, await find(page, 'block', 'c'));
    await expect.poll(() => said(page)).toEqual(['C.']);
    await release(page);
    await expect.poll(() => said(page), { timeout: 5000 }).toContain('cow');
    expect(await playedRecordings(page)).toEqual([]);
    expect(hal.consoleErrors).toEqual([]);
  });

  it('mic denied: recording is off (no-mic) and says so; the barn still plays', async () => {
    const { page, hal } = await open(denyMic);
    await openCorner(page);
    await voices(page).getByRole('button', { name: 'C c', exact: true }).tap();
    await row(page, /name.*cow/i).getByRole('button', { name: /^record$/i }).tap();
    await expect.poll(() => voices(page).getAttribute('data-why')).toBe('no-mic');
    await expect(voices(page).getByText(/recording is off/i).isVisible()).resolves.toBe(true);
    await expect(voices(page).getByText(/microphone/i).first().isVisible()).resolves.toBe(true);
    await expect(voices(page).getByRole('button', { name: /^record$/i }).count()).resolves.toBe(0);
    await closeCorner(page);
    await seedWith(page, 'c');
    await tap(page, await find(page, 'block', 'c'));
    await expect.poll(() => said(page)).toEqual(['C.']);
    expect(hal.consoleErrors).toEqual([]);
  });

  it('IndexedDB throwing: recording is off (no-storage) and says so; the barn still plays', async () => {
    const { page, hal } = await open(breakIndexedDb);
    await openCorner(page);
    await expect.poll(() => voices(page).getAttribute('data-why')).toBe('no-storage');
    await expect(voices(page).getByText(/recording is off/i).isVisible()).resolves.toBe(true);
    await expect(voices(page).getByText(/can't keep recordings/i).isVisible()).resolves.toBe(true);
    await expect(voices(page).getByRole('button', { name: /^record$/i }).count()).resolves.toBe(0);
    await closeCorner(page);
    await seedWith(page, 'c');
    await tap(page, await find(page, 'block', 'c'));
    await expect.poll(() => said(page)).toEqual(['C.']);
    expect(hal.consoleErrors).toEqual([]);
  });

  for (const how of ['visibilitychange', 'pagehide'] as const) {
    it(`the tab hiding (${how}) stops a recording in progress and turns the microphone off`, async () => {
      const { page, hal } = await open(watchMic);
      await openCorner(page);
      await voices(page).getByRole('button', { name: 'C c', exact: true }).tap();
      const name = row(page, /name.*cow/i);
      await name.getByRole('button', { name: /^record$/i }).tap();
      await name.getByRole('button', { name: /^stop$/i }).waitFor({ timeout: 5000 });
      const live = () => page.evaluate(() => (window as any).__streams.flatMap((st: MediaStream) => st.getTracks()).filter((t: MediaStreamTrack) => t.readyState === 'live').length);
      expect(await live()).toBeGreaterThan(0);
      await page.evaluate((h) => {
        if (h === 'pagehide') { dispatchEvent(new Event('pagehide')); return; }
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, how);
      await expect.poll(live, { timeout: 3000 }).toBe(0);
      await expect(name.getByRole('button', { name: /^stop$/i }).count()).resolves.toBe(0);
      expect(hal.consoleErrors).toEqual([]);
    });
  }

  it('keep failing (the transaction aborts) says so on that row, and the recording can be kept again', async () => {
    const { page, hal } = await open(failPut);
    await recordCow(page);
    const name = row(page, /name.*cow/i);
    await name.getByRole('button', { name: /^keep$/i }).tap();
    await name.getByText("Couldn't keep this recording. Try again.").waitFor({ timeout: 5000 });
    await expect(name.getByRole('button', { name: /^keep$/i }).isVisible()).resolves.toBe(true);
    await expect(name.getByText(/your voice/i).count()).resolves.toBe(0);
    expect(hal.consoleErrors).toEqual([]);
  });

  it('tapping a letter with no recording does no IndexedDB read', async () => {
    const { page, hal } = await open(countTx);
    await page.waitForFunction(() => (window as any).__tx >= 1, null, { timeout: 5000 }); // the one load of recorded keys
    await page.waitForTimeout(300);
    await seedWith(page, 'c');
    const before = await page.evaluate(() => (window as any).__tx);
    await tap(page, await find(page, 'block', 'c'));
    await release(page);
    await expect.poll(() => said(page), { timeout: 8000 }).toContain('moo');
    expect(await page.evaluate(() => (window as any).__tx)).toBe(before);
    expect(hal.consoleErrors).toEqual([]);
  });

  it('not a secure page: recording is off (insecure) and asks for the https version', async () => {
    const { page, hal } = await open(insecure);
    await openCorner(page);
    expect(await voices(page).getAttribute('data-why')).toBe('insecure');
    await expect(voices(page).getByText('Recording needs the secure (https) version of this page.').isVisible()).resolves.toBe(true);
    await expect(voices(page).getByRole('button', { name: /^record$/i }).count()).resolves.toBe(0);
    expect(hal.consoleErrors).toEqual([]);
  });
});
