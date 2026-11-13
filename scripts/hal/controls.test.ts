// Browser tests for the real-input controls check (HAL_BROWSER=1 npx vitest run --project hal-browser).
import { describe, expect, it } from 'vitest';
import { runControlsCheck, type ControlCheck } from './controls.js';

const find = (cs: ControlCheck[], game: string, check: string) => cs.find((c) => c.game === game && c.check === check);

describe('runControlsCheck', () => {
  it('every non-skipped check passes on the real games', async () => {
    const checks = await runControlsCheck();
    const failed = checks.filter((c) => !c.skipped && !c.ok);
    expect(failed).toEqual([]);
    expect(new Set(checks.map((c) => c.game.split(' ')[0]))).toEqual(new Set(['gearhold', 'tidepool-pals', 'hyperline', 'lanternkeep', 'block-barn']));
    expect(find(checks, 'block-barn', 'touch tap on a block names it')).toMatchObject({ ok: true });
    // the core real-input paths must actually run, not be skipped
    for (const c of ['key KeyW moves fwd', 'key Space fires', 'touch stick (left half drag) moves forward',
      'touch look (right half drag) changes a and look', 'touch tap #fire fires', 'touch events reach the game as pointerType touch',
      'keys Digit2 / Digit1 swap weapon (scatter granted)', 'touch tap #swap toggles weapon (scatter granted)']) {
      expect(find(checks, 'gearhold', c), c).toMatchObject({ ok: true });
      expect(find(checks, 'gearhold', c)!.skipped, c).toBeUndefined();
    }
    for (const c of checks.filter((c) => c.skipped)) expect(c.ok).toBe(true);
    // the only allowed skip is mouse look, and only for the headless pointer-lock refusal
    expect(checks.filter((c) => c.skipped).map((c) => `${c.check}: ${c.skipped}`)).toEqual(
      checks.some((c) => c.check === 'mouse look' && c.skipped) ? ['mouse look: pointer lock unavailable headless'] : []);
    // every context runs in newHalContext; fonts are bundled, so each game and context has a passing no-outbound check
    const outbound = checks.filter((c) => c.check === 'no outbound requests');
    expect(outbound).toHaveLength(checks.filter((c) => c.check === 'no page errors').length);
    for (const c of outbound) expect(c).toMatchObject({ ok: true, detail: 'blocked requests: none' });
  }, 180_000);

  it('fails the W check when the keydown listener is removed', async () => {
    // Drop every keydown listener registered on window, before the game's scripts run.
    const initScript = `(() => {
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, ...rest) {
        if (type === 'keydown' && (this || window) === window) return;
        return orig.call(this, type, ...rest);
      };
    })();`;
    const checks = await runControlsCheck({ initScript });
    expect(find(checks, 'gearhold', 'key KeyW moves fwd')).toMatchObject({ ok: false });
    expect(find(checks, 'gearhold', 'key Space fires')).toMatchObject({ ok: false });
    // touch does not use keydown, so it still passes: the check fails for the right reason
    expect(find(checks, 'gearhold', 'touch stick (left half drag) moves forward')).toMatchObject({ ok: true });
  }, 180_000);

  it('fails the stick and look checks when pointermove is dropped', async () => {
    // Drop every pointermove listener, before the game's scripts run: drags still start and end, but never move.
    const initScript = `(() => {
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, ...rest) {
        if (type === 'pointermove') return;
        return orig.call(this, type, ...rest);
      };
    })();`;
    const checks = await runControlsCheck({ initScript });
    expect(find(checks, 'gearhold', 'touch stick (left half drag) moves forward')).toMatchObject({ ok: false });
    expect(find(checks, 'gearhold', 'touch look (right half drag) changes a and look')).toMatchObject({ ok: false });
    // taps and keys do not use pointermove, so they still pass: the check fails for the right reason
    expect(find(checks, 'gearhold', 'touch tap #fire fires')).toMatchObject({ ok: true });
    expect(find(checks, 'gearhold', 'key KeyW moves fwd')).toMatchObject({ ok: true });
  }, 180_000);
});
