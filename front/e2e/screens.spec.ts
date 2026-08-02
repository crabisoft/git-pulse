import { test, expect, type Page } from '@playwright/test';
import { ROUTES, EMPTY_PAGE } from './fixtures';

/**
 * What the pages actually look like, at the widths they are actually read at.
 *
 * The unit suites cannot answer this: jsdom computes no layout, so a page
 * broken at 360px passes every one of them. What this checks is the single
 * failure that makes an application feel broken rather than cramped — the
 * document being wider than the window, which moves everything on the page and
 * not just the thing that overflowed.
 */

const WIDTHS = [
  { name: 'phone', width: 360, height: 780 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/**
 * The pages worth checking, and what has to be on them before they are.
 *
 * A readiness selector may match either rendering: the deployment rows are a
 * table on a wide screen and a card list on a phone, which is the point.
 */
const PAGES: Array<{
  name: string;
  path: string;
  ready: string;
  /** Run before measuring, for a page whose state is not in its address. */
  prepare?: (page: Page) => Promise<void>;
}> = [
  { name: 'deployments', path: '/deployments/acme-platform', ready: 'table, .card-list' },
  { name: 'changelogs', path: '/changelogs/acme-platform', ready: '.page-head' },
  { name: 'users', path: '/settings/users', ready: 'table, .card-list' },
  { name: 'sources', path: '/settings/sources', ready: '.source-row' },
  { name: 'settings-general', path: '/settings', ready: '.blocks' },
  // The widest table the settings hold: six columns of what is in flight.
  { name: 'settings-jobs', path: '/settings/jobs', ready: 'table.data, .card-list' },
  { name: 'account', path: '/account', ready: '.account-head' },
  /**
   * The widest thing the application draws: five repos over fifteen
   * environments. It is the case the text column used to hide — a grid of three
   * fits inside 1180px and proves nothing about a grid that does not.
   *
   * The direction is not in the address, so it is switched the way a reader
   * switches it. That also keeps the fixture honest: what is measured is the
   * grid the application actually renders, not one assembled for the test.
   */
  {
    name: 'overview-versions',
    path: '/dashboard/acme-platform',
    ready: '.versions-matrix',
    prepare: async (page) => {
      await page.locator('.direction-switch select').selectOption('versions');
    },
  },
];

/** Answers every API call from the fixtures, so a screen never waits on a network. */
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

/**
 * How far the document overflows its window, in pixels.
 *
 * `documentElement.scrollWidth` against the viewport is the whole test: a page
 * that fits has none, and one that does not scrolls sideways as a whole.
 */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

/** What is sticking out, named — a failure has to say where to look. */
async function offenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > limit + 1)
      .slice(0, 6)
      .map((el) => {
        const cls = typeof el.className === 'string' ? el.className : '';
        const right = Math.round(el.getBoundingClientRect().right);
        return `${el.tagName.toLowerCase()}.${cls.split(' ')[0] || '?'} → ${right}px`;
      });
  });
}

for (const size of WIDTHS) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const target of PAGES) {
      test(`${target.name} fits`, async ({ page }) => {
        await stubApi(page);
        await page.goto(target.path);
        await target.prepare?.(page);
        await page.locator(target.ready).first().waitFor({ timeout: 10_000 });

        await page.screenshot({
          path: `e2e/screens/${target.name}-${size.name}.png`,
          fullPage: true,
        });

        expect(await overflow(page), (await offenders(page)).join('\n')).toBe(0);
      });
    }
  });
}

test.describe('two renderings, not one shrunk', () => {
  test('a phone reads deployments as cards', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await stubApi(page);
    await page.goto('/deployments/acme-platform');

    // Six columns dragged sideways is not a deployment list. The rows are the
    // same records either way — only one of the two is in the document.
    await expect(page.locator('.card-list')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
  });

  test('a desktop reads them as a table', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubApi(page);
    await page.goto('/deployments/acme-platform');

    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('.card-list')).toHaveCount(0);
  });
});

test.describe('phone navigation', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('folds the sections into a drawer that opens', async ({ page }) => {
    await stubApi(page);
    await page.goto('/deployments/acme-platform');

    const burger = page.getByRole('button', { name: 'Sections' });
    await expect(burger).toBeVisible();
    // Present in the document at every width — it is the strip, folded — so
    // what is checked is that it is not on screen until it is asked for.
    await expect(page.getByRole('link', { name: 'DORA' })).toBeHidden();

    await burger.click();
    await expect(page.getByRole('link', { name: 'DORA' })).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/nav-drawer-phone.png' });
  });
});

/**
 * The porthole, measured rather than assumed.
 *
 * The overflow check above passes just as happily on a grid trapped in the
 * 1180px text column — it never overflowed, it was merely unreadable. What is
 * asserted here is the thing that was actually wrong: at 1440px the grid has to
 * use the window, and at every width it has to stop at the window's edge.
 */
test.describe('a wide grid reads through the window', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openVersions(page: Page) {
    await stubApi(page);
    await page.goto('/dashboard/acme-platform');
    await page.locator('.direction-switch select').selectOption('versions');
    await page.locator('.versions-matrix').waitFor({ timeout: 10_000 });
  }

  test('reaches past the text column, and stops at the page gutter', async ({ page }) => {
    await openVersions(page);

    const grid = (await page.locator('.matrix-scroll').boundingBox())!;
    const column = (await page.locator('.content').boundingBox())!;

    // Wider than the column that used to hold it: fifteen environments no
    // longer read through a 1180px slot on a 1440px screen.
    expect(grid.width).toBeGreaterThan(column.width);
    // And no further than the page's own margins, which is what keeps the
    // document from scrolling sideways.
    expect(grid.x).toBeGreaterThanOrEqual(24);
    expect(Math.round(grid.x + grid.width)).toBeLessThanOrEqual(1440 - 24);
  });

  test('keeps the repo beside the version while the grid scrolls', async ({ page }) => {
    await openVersions(page);

    const head = page.locator('.versions-matrix .matrix-row-head').first();
    const before = (await head.boundingBox())!;
    await page.locator('.matrix-scroll').evaluate((el) => el.scrollBy(400, 0));

    // A wide table scrolled sideways loses the repo, and the repo is what
    // gives the version being read its meaning.
    const after = (await head.boundingBox())!;
    expect(Math.round(after.x)).toBe(Math.round(before.x));
  });

  test('leaves a grid that fits exactly where it was', async ({ page }) => {
    await stubApi(page);
    await page.goto('/dashboard/acme-platform');
    await page.locator('.direction-switch select').selectOption('instrument');
    await page.locator('.matrix').waitFor({ timeout: 10_000 });

    const grid = (await page.locator('.matrix-scroll').boundingBox())!;
    const column = (await page.locator('.content').boundingBox())!;

    // Two dimensions crossed is a handful of columns: `fit-content` is narrower
    // than the column, so the escape has nothing to do and does nothing.
    expect(grid.width).toBeLessThanOrEqual(column.width);
  });

  /**
   * Width was the whole of what this suite used to check, and it was half the
   * question. An escape pulling both edges out moved every grid, wide or not:
   * three columns started in the page gutter, a hundred pixels left of the
   * heading above them, and the assertion on width had nothing to say about it.
   */
  test('starts where the heading above it starts, while it fits', async ({ page }) => {
    await stubApi(page);
    await page.goto('/dashboard/acme-platform');
    await page.locator('.direction-switch select').selectOption('instrument');
    await page.locator('.matrix').waitFor({ timeout: 10_000 });

    const grid = (await page.locator('.matrix-scroll').boundingBox())!;
    const head = (await page.locator('.matrix-head').boundingBox())!;

    expect(Math.round(grid.x)).toBe(Math.round(head.x));
  });

  test('leaves that line only once it takes the page', async ({ page }) => {
    await openVersions(page);

    const grid = (await page.locator('.matrix-scroll').boundingBox())!;
    const head = (await page.locator('.matrix-head').boundingBox())!;

    // Fifteen environments: past the threshold, so the grid is out in the
    // gutters on purpose — and symmetrically, which is what "full width" means.
    expect(grid.x).toBeLessThan(head.x);
    expect(Math.round(grid.x)).toBe(1440 - Math.round(grid.x + grid.width));
  });
});
