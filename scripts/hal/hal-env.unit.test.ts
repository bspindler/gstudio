// .hal.env holds the API key; it must stay git-ignored.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('.hal.env is git-ignored', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const r = spawnSync('git', ['check-ignore', '.hal.env'], { cwd: root });
  expect(r.status).toBe(0);
});
