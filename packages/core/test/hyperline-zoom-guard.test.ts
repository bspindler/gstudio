import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');

describe('hyperline zoom guard', () => {
  it('stops double-tap zoom while tapping fast to jump', () => {
    expect(html.match(/html,body\{([^}]*)\}/)![1]).toContain('touch-action:manipulation');
    expect(html.match(/#game\{([^}]*)\}/)![1]).toContain('touch-action:none');
    expect(html).toMatch(/addEventListener\('gesturestart',\s*\(e\) => e\.preventDefault\(\)\)/);
  });
});
