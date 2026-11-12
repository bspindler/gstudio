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
