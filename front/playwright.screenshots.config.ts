import { defineConfig, devices } from '@playwright/test';

/**
 * The documentation screenshots, kept apart from the layout suite.
 *
 * Two reasons for a config of its own: this writes into `docs/images/`, which
 * a test run has no business doing, and it runs one browser at one size where
 * the layout suite runs three. `npm run test:layout` ignores this spec.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/screenshots.spec.ts',
  outputDir: './e2e/.results',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npx vite --config vite.screens.config.ts',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
