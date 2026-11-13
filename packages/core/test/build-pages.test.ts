import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

// Ordinary games without level events are still rejected: see compliance.test.ts ("leaves ordinary games unchanged").
describe('build:pages', () => {
  it('builds every game, including the child-directed Block Barn (it has no level events)', () => {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-pages.ts'], { cwd: repo, stdio: 'pipe' });
    expect(existsSync(fileURLToPath(new URL('../../../_site/block-barn/index.html', import.meta.url)))).toBe(true);
  }, 60_000);
});
