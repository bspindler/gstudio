import { defineConfig } from 'vitest/config';

// Browser tests for the ?hal hook and play runners. Opt-in so the default `npm test` and CI stay browser-free:
// HAL_BROWSER=1 npx vitest run --project hal-browser
// Without HAL_BROWSER only *.unit.test.ts run (no browser launched; Playwright is mocked there).
export default defineConfig({
  test: {
    name: 'hal-browser',
    include: process.env.HAL_BROWSER ? ['*.test.ts'] : ['*.unit.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
