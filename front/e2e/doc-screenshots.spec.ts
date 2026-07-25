import { test, type Page } from '@playwright/test';
import { ROUTES, EMPTY_PAGE, NOW } from './fixtures';

/**
 * The screenshots the user guide shows.
 *
 * Deliberately not the README's suite. Those five images illustrate a project
 * page on GitHub and change when the pitch changes; these follow the guide's
 * pages, which is a different list with a different reason to move. The two
 * have no reason to hold the same pictures, so they are generated apart.
 *
 * Not a test: nothing here asserts. The API is stubbed from the same fixtures
 * the layout suite uses, so this needs the dev server and nothing else.
 *
 *   npm run screenshots:docs -w @repo/front
 */

/**
 * One entry per figure the guide references, named after the file it writes.
 *
 * `direction` picks one of the three readings of the Overview through the
 * control a reader would use, rather than by seeding the storage it is
 * mirrored into — the screenshot then shows a state the application can
 * actually be put in.
 */
const SHOTS = [
  {
    name: 'overview-control',
    path: '/dashboard/acme-platform',
    ready: '.board, .friction',
    direction: 'control',
  },
  {
    name: 'overview-instrument',
    path: '/dashboard/acme-platform',
    ready: '.gauges, .matrix',
    direction: 'instrument',
  },
  {
    name: 'overview-stream',
    path: '/dashboard/acme-platform',
    ready: '.stream .river, .stream .rail',
    direction: 'stream',
  },
  {
    name: 'overview-versions',
    path: '/dashboard/acme-platform',
    ready: '.matrix-scroll, .empty-note',
    direction: 'versions',
  },
  { name: 'dora', path: '/dora/acme-platform', ready: '.metric-card' },
  { name: 'dora-metric', path: '/dora/acme-platform/lead_time', ready: '.page-head' },
  { name: 'deployments', path: '/deployments/acme-platform', ready: 'table, .card-list' },
  { name: 'history', path: '/changelogs/acme-platform', ready: '.page-head' },
  { name: 'settings-sources', path: '/settings/sources', ready: '.source-row' },
  { name: 'settings-jobs', path: '/settings/jobs', ready: 'table.data, .card-list' },
  { name: 'account', path: '/account', ready: '.account-head' },
];

async function stubApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const match = ROUTES.find(([pattern]) => pattern.test(url));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(match ? match[1] : EMPTY_PAGE),
    });
  });
}

// Wide enough to show a table as a table, and twice the pixels so the images
// stay readable where a browser scales them down. The locale is pinned because
// the account fixture states none: the interface follows the browser, and the
// guide is written in English.
test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'en-US',
});

for (const shot of SHOTS) {
  test(`doc screenshot: ${shot.name}`, async ({ page }) => {
    await stubApi(page);
    // Pinned to the instant the fixtures describe: without it the images say
    // "366d ago" where the application would say "8m ago".
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto(shot.path);
    if (shot.direction) {
      await page.selectOption('.direction-switch select', shot.direction);
    }
    await page.waitForSelector(shot.ready, { timeout: 15_000 });
    // Charts and counters animate on mount; the image is taken once they have
    // settled, or half a sparkline gets published.
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: `../docs/user/source/images/${shot.name}.png` });
  });
}
