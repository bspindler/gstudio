import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askHalToScore, startScoreBroker, type Broker } from './score-broker.js';

const dirs: string[] = [];
let broker: Broker | undefined;
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'hal-broker-test-')); dirs.push(d); return d; };
afterEach(async () => {
  await broker?.stop(); broker = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fast = { pollMs: 10 };

describe('score broker', () => {
  it('answers a request with the report from score(), and the client returns it', async () => {
    const dir = fresh();
    const asked: string[] = [];
    broker = startScoreBroker({ dir, scorers: ['gearhold', 'gearhold-play'], score: async (s) => { asked.push(s); return { game: s, fitness: 74.7 }; }, ...fast });
    await expect(askHalToScore(dir, 'gearhold-play', { ...fast, timeoutMs: 5000 })).resolves.toEqual({ game: 'gearhold-play', fitness: 74.7 });
    expect(asked).toEqual(['gearhold-play']);
    expect(broker.served()).toBe(1);
    expect(readdirSync(dir)).toEqual([]); // request and response both cleaned up
  });

  it('refuses a scorer that is not this game\'s, without calling score()', async () => {
    const dir = fresh();
    let called = false;
    broker = startScoreBroker({ dir, scorers: ['gearhold'], score: async () => { called = true; return {}; }, ...fast });
    await expect(askHalToScore(dir, 'tidepool-pals', { ...fast, timeoutMs: 5000 })).rejects.toThrow(/unknown scorer "tidepool-pals".*gearhold/);
    expect(called).toBe(false);
  });

  it('turns a failing score into an error the client throws', async () => {
    const dir = fresh();
    broker = startScoreBroker({ dir, scorers: ['gearhold'], score: async () => { throw new Error('scripts/hal differs from main'); }, ...fast });
    await expect(askHalToScore(dir, 'gearhold', { ...fast, timeoutMs: 5000 })).rejects.toThrow(/Hal could not score gearhold: scripts\/hal differs from main/);
  });

  it('caps the scores per build', async () => {
    const dir = fresh();
    broker = startScoreBroker({ dir, scorers: ['gearhold'], score: async () => ({ ok: 1 }), maxRequests: 2, ...fast });
    await askHalToScore(dir, 'gearhold', fast);
    await askHalToScore(dir, 'gearhold', fast);
    await expect(askHalToScore(dir, 'gearhold', { ...fast, timeoutMs: 5000 })).rejects.toThrow(/already scored 2 times/);
    expect(broker.served()).toBe(2);
  });

  it('never follows a planted link: a request link is refused, and a response link is replaced, not written through', async () => {
    const dir = fresh();
    const outside = join(fresh(), 'victim.txt');
    writeFileSync(outside, 'original');
    symlinkSync(outside, join(dir, 'req-aaaaaaaa.json')); // request that is a link
    symlinkSync(outside, join(dir, 'res-aaaaaaaa.json')); // response name pre-planted as a link
    let called = false;
    broker = startScoreBroker({ dir, scorers: ['gearhold'], score: async () => { called = true; return {}; }, ...fast });
    await new Promise((d) => setTimeout(d, 200));
    expect(called).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe('original');
    expect(JSON.parse(readFileSync(join(dir, 'res-aaaaaaaa.json'), 'utf8'))).toEqual({ ok: false, error: 'bad request: request is not a regular file' });
  });

  it('refuses junk and oversized requests', async () => {
    const dir = fresh();
    writeFileSync(join(dir, 'req-bbbbbbbb.json'), 'not json');
    writeFileSync(join(dir, 'req-cccccccc.json'), JSON.stringify({ scorer: 'x'.repeat(2000) }));
    writeFileSync(join(dir, 'req-NOTVALID.json'), '{}'); // ignored: not a request name
    broker = startScoreBroker({ dir, scorers: ['gearhold'], score: async () => ({}), ...fast });
    await new Promise((d) => setTimeout(d, 200));
    expect(JSON.parse(readFileSync(join(dir, 'res-bbbbbbbb.json'), 'utf8')).error).toMatch(/^bad request: /);
    expect(JSON.parse(readFileSync(join(dir, 'res-cccccccc.json'), 'utf8')).error).toBe('bad request: request is too large');
    expect(readdirSync(dir)).toContain('req-NOTVALID.json');
  });

  it('the client times out with a retry hint when nobody answers', async () => {
    const dir = fresh();
    await expect(askHalToScore(dir, 'gearhold', { pollMs: 10, timeoutMs: 50 })).rejects.toThrow(/did not answer.*run the same command again/);
  });
});
