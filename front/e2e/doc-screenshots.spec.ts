import { test, type Page } from '@playwright/test';
import { DORA_TRUNCATED, ROUTES, EMPTY_PAGE, NOW } from './fixtures';

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

interface Shot {
  /** The file written, and what the guide references it by. */
  name: string;
  path: string;
  /** What has to be on the page before it is worth photographing. */
  ready: string;
  /**
   * One of the Overview's four readings, picked through the control a reader
   * would use rather than by seeding the storage it is mirrored into — the
   * screenshot then shows a state the application can actually be put in.
   */
  direction?: string;
  /**
   * The rest of the way there, for a figure whose state is behind a click: a
   * dialog opened, a tab chosen, a range generated. Same principle as the
   * direction — the picture is of the application being used.
   */
  prepare?: (page: Page) => Promise<void>;
  /**
   * Photograph this element rather than the window. What it buys is a dialog
   * without the dimmed page behind it, and a banner without the page it warns
   * about — a figure the size of the thing being explained.
   */
  clip?: string;
  /**
   * Routes answered differently for this figure alone, tried before the shared
   * ones. For the two states no click reaches: an install with no account yet,
   * and a read the platform ran out of pages on.
   */
  stub?: Array<[RegExp, unknown]>;
}

/** One entry per figure the guide references, named after the file it writes. */
const SHOTS: Shot[] = [
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
  {
    // The one state the interface cannot be clicked into: what the read ran
    // into, on a monorepo whose merges outran the page cap.
    name: 'dora-truncated',
    path: '/dora/acme-platform',
    ready: '.banner.warn',
    clip: '.banner.warn',
    stub: [[/\/api\/sources\/[^/]+\/dora(?!\/samples)/, DORA_TRUNCATED]],
  },
  { name: 'deployments', path: '/deployments/acme-platform', ready: 'table, .card-list' },
  { name: 'history', path: '/changelogs/acme-platform', ready: '.page-head' },
  {
    name: 'release-notes',
    path: '/release-notes/acme-platform',
    ready: '.filters-row',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Generate' }).click();
      await page.waitForSelector('.notes-list');
    },
  },
  {
    // The screen an install with no account at all offers, which every other
    // figure here is signed in past.
    name: 'first-admin',
    path: '/',
    ready: '.auth-card',
    clip: '.auth-card',
    stub: [[/\/api\/auth\/me$/, { user: null, publicDashboard: false, setupRequired: true }]],
  },
  { name: 'settings-sources', path: '/settings/sources', ready: '.source-row' },
  {
    name: 'source-form',
    path: '/settings/sources',
    ready: '.source-row',
    clip: '.modal',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Add a source' }).click();
      await page.waitForSelector('.modal');
      // Filled the way the guide's own walkthrough fills it. An empty form
      // photographs as a stack of boxes; this one says what goes in them.
      const modal = page.locator('.modal');
      await modal.getByLabel('Name', { exact: true }).fill('Acme — Prod');
      await modal.getByLabel('Organization', { exact: true }).fill('acme');
      // By type rather than by label: the label carries its hint with it.
      await modal.locator('input[type="password"]').fill('github_pat_11ABCDEFG');
    },
  },
  { name: 'settings-environments', path: '/settings/environments', ready: '.source-row' },
  {
    name: 'rule-test',
    path: '/settings/environments',
    ready: '.source-row',
    clip: '.modal',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Test the rule set' }).click();
      await page.locator('.preview-row .mono-input').first().fill('acme-billing-prod');
      await page.getByRole('button', { name: 'Classify' }).click();
      await page.waitForSelector('.classify-result');
    },
  },
  {
    // The monorepo rule, reopened from the catalogue rather than typed: the
    // form then shows a rule that was actually saved.
    name: 'rule-form',
    path: '/settings/environments',
    ready: '.source-row',
    clip: '.modal',
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'PR titles' }).click();
      // The rules of the tab that was showing are on screen until this one's
      // arrive, so the row is waited for by name rather than by shape.
      const rule = page.locator('.source-row').filter({ hasText: 'Conventional Commits' });
      await rule.getByRole('button', { name: 'Edit' }).click();
      await page.waitForSelector('.modal');
    },
  },
  { name: 'settings-jobs', path: '/settings/jobs', ready: 'table.data, .card-list' },
  { name: 'account', path: '/account', ready: '.account-head' },
];

async function stubApi(page: Page, extra: Array<[RegExp, unknown]> = []) {
  const routes = [...extra, ...ROUTES];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const match = routes.find(([pattern]) => pattern.test(url));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(match ? match[1] : EMPTY_PAGE),
    });
  });
}

// Wide enough to show a table as a table. The scale factor is set against what
// the guide actually draws: figures are capped at 1000px there, so 1.5 still
// leaves more than two device pixels per displayed one on a dense screen, and
// it is a third of the weight of asking for 2. The locale is pinned because the
// account fixture states none: the interface follows the browser, and the guide
// is written in English.
test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  colorScheme: 'light',
  locale: 'en-US',
});

for (const shot of SHOTS) {
  test(`doc screenshot: ${shot.name}`, async ({ page }) => {
    await stubApi(page, shot.stub);
    // Pinned to the instant the fixtures describe: without it the images say
    // "366d ago" where the application would say "8m ago".
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto(shot.path);
    if (shot.direction) {
      await page.selectOption('.direction-switch select', shot.direction);
    }
    await page.waitForSelector(shot.ready, { timeout: 15_000 });
    await shot.prepare?.(page);
    // Charts and counters animate on mount; the image is taken once they have
    // settled, or half a sparkline gets published.
    await page.waitForTimeout(1_200);
    const target = shot.clip ? page.locator(shot.clip) : page;
    await target.screenshot({ path: `../docs/user/source/images/${shot.name}.png` });
  });
}
