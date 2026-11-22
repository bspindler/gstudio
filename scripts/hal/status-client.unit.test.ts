import { describe, expect, it } from 'vitest';
import { phaseProgress, STATUS_JS } from './status-client.js';

describe('phaseProgress', () => {
  it('maps run phases to 0..1 in order, builds by ticket', () => {
    const seq = ['lock', 'preflight', 'play', 'plan', 'build HAL-001 (1/3)', 'build HAL-002 (2/3)', 'build HAL-003 (3/3)', 'note', 'push', 'report'].map(phaseProgress);
    for (const p of seq) expect(p).not.toBeNull();
    for (let i = 1; i < seq.length; i++) expect(seq[i]!, String(i)).toBeGreaterThan(seq[i - 1]!);
    expect(seq[seq.length - 1]!).toBeLessThan(1);
  });
  it('unknown or malformed phases are null (an indeterminate bar)', () => {
    expect(phaseProgress('preflight: checking 2 replayed commits (ci:local)')).toBe(phaseProgress('preflight'));
    for (const p of [undefined, '', 'undo HAL-001', 'build HAL-001 (0/3)', 'build HAL-001 (4/3)', 'whatever']) expect(phaseProgress(p), String(p)).toBeNull();
  });
});

describe('STATUS_JS', () => {
  it('checks soon after load and every 5 s, idle or running', () => {
    expect(STATUS_JS).toContain('later(800)');
    expect(STATUS_JS).toContain('later(5000)');
    expect(STATUS_JS).not.toContain('30000');
  });
  it('parses, and writes text only', () => {
    expect(() => new Function(STATUS_JS)).not.toThrow();
    expect(STATUS_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|eval\(|document\.write/);
  });
});

describe('STATUS_JS keeps your place across a button tap (every form posts and the page reloads)', () => {
  /** A page of cards in happy-dom with a real sessionStorage; `run` executes /hal.js in it. */
  const page = async (html: string) => {
    const { Window } = await import('happy-dom');
    const w = new Window({ url: 'http://hal.test/' });
    w.document.body.innerHTML = html;
    const scrolls: number[] = [];
    w.scrollTo = ((x: number | { top?: number }, y?: number) => { scrolls.push(typeof x === 'number' ? y! : x.top ?? 0); }) as typeof w.scrollTo;
    const run = () => new w.Function('window', 'document', 'sessionStorage', STATUS_JS)(w, w.document, w.sessionStorage);
    return { w, scrolls, run };
  };
  const CARDS = '<article class="card" id="a"><form method="post" action="/vote"><input type="hidden" name="pass" value="HAL-1"><button>Keep</button></form></article>'
    + '<article class="card" id="b"><form method="post" action="/vote"><input type="hidden" name="pass" value="HAL-2"><button>Keep</button></form></article>';
  it('on submit it saves the tapped card and where it sat; after the reload it puts that card back in the same spot', async () => {
    const { w, scrolls, run } = await page(CARDS);
    run();
    Object.defineProperty(w, 'scrollY', { value: 900, configurable: true });
    const b = w.document.getElementById('b')!;
    (b as unknown as { getBoundingClientRect: () => { top: number } }).getBoundingClientRect = () => ({ top: 300 });
    b.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true }));
    const saved = JSON.parse(w.sessionStorage.getItem('hal-place')!);
    expect(saved).toMatchObject({ y: 900, key: 'pass=HAL-2', top: 300, path: '/' });
    // the reload: same storage, the card now sits 1500px down the page
    Object.defineProperty(w, 'scrollY', { value: 0, configurable: true });
    (b as unknown as { getBoundingClientRect: () => { top: number } }).getBoundingClientRect = () => ({ top: 1500 });
    run();
    expect(scrolls.at(-1)).toBe(1200); // 0 + 1500 - 300
    expect(w.sessionStorage.getItem('hal-place')).toBeNull(); // used once
  });
  it('a card that is gone falls back to the same scroll position; a stale or other page\'s place is ignored', async () => {
    const { w, scrolls, run } = await page(CARDS);
    w.sessionStorage.setItem('hal-place', JSON.stringify({ y: 700, key: 'pass=HAL-9', top: 10, path: '/', at: Date.now() }));
    run();
    expect(scrolls.at(-1)).toBe(700);
    w.sessionStorage.setItem('hal-place', JSON.stringify({ y: 700, path: '/runs/x', at: Date.now() }));
    scrolls.length = 0;
    run();
    w.sessionStorage.setItem('hal-place', JSON.stringify({ y: 700, path: '/', at: Date.now() - 10 * 60_000 }));
    run();
    expect(scrolls).toEqual([]);
  });
});
