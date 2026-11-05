import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { complianceViolations, gameSources } from '../src/index.js';

const game = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'game-src-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...rel.split('/')), text);
  }
  return dir;
};

const html = `<!doctype html><html><body><button id="go">Play</button>
<script type="module" src="./game.js"></script></body></html>`;
const compliantJs = `import { createStudio, resolveEndpoint } from '../sdk/studio-sdk.js';
const { track, feedback } = createStudio({ endpoint: resolveEndpoint(location, window.STUDIO_CONFIG) });
track('level_start', {});
track('level_end', {});
feedback.maybePrompt();
`;

describe('gameSources', () => {
  it('joins every .html and .js file, recursively, in sorted order, and nothing else', () => {
    const dir = game({
      'index.html': 'H', 'game.js': 'G', 'lib/a.js': 'A', 'lib/z/deep.js': 'D',
      'game.yaml': 'Y', 'art/x.png': 'P', 'style.css': 'C',
    });
    expect(gameSources(dir)).toBe(['G', 'H', 'A', 'D'].join('\n'));
  });

  it('flags purchase-like text in game.js when nothing calls purchase.offer(', () => {
    const dir = game({ 'index.html': html, 'game.js': `${compliantJs}const label = 'Buy 100 coins';\n` });
    expect(complianceViolations(gameSources(dir)).some((v) => v.includes('purchase.offer'))).toBe(true);
  });

  it('passes a game split across index.html and game.js that is compliant overall', () => {
    const dir = game({ 'index.html': html, 'game.js': compliantJs });
    expect(complianceViolations(gameSources(dir))).toEqual([]);
  });
});
