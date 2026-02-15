import { defineConfig, devices } from '@playwright/test';

/**
 * The layout suite.
 *
 * Separate from `vitest`, and deliberately: everything under `src` runs in
 * jsdom, which computes no layout at all — a page can be broken at 360px with
 * all of it green. This is the only place in the repository where a real
 * engine measures a real page, so it is the only place a responsive rule can
 * be said to work.
 *
 * The API is stubbed by the suite itself (see `e2e/screens.spec.ts`), so this
 * needs the dev server and nothing else — no database, no queue, no backend.
 */
export default defineConfig({
  testDir: './e2e',
  // The screenshots are written on every run and read by whoever is looking at
  // a change; the assertions are what fail. Kept out of git — see .gitignore.
  outputDir: './e2e/.results',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // The same server as `npm run dev`, with a cache directory it can write to
    // — see `vite.screens.config.ts`.
    command: 'npx vite --config vite.screens.config.ts',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
