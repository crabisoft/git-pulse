import { defineConfig, devices } from '@playwright/test';

/**
 * The user guide's screenshots, kept apart from the README's.
 *
 * Same reasons the README suite has a config of its own: it writes outside the
 * test tree, and it runs one browser at one size where the layout suite runs
 * three. `npm run test:layout` ignores both specs.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/doc-screenshots.spec.ts',
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
