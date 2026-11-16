import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals zoom guard', () => {
  it('stops double-tap and pinch zoom while swiping', () => {
    expect(html.match(/\.tiles\{([^}]*)\}/)![1]).toContain('touch-action:none');
    expect(html.match(/html,body\{([^}]*)\}/)![1]).toContain('touch-action:manipulation');
    expect(html).toMatch(/addEventListener\('gesturestart',\s*\(e\) => e\.preventDefault\(\)\)/);
  });
});
