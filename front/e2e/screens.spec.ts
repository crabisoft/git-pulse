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
const PAGES = [
  { name: 'deployments', path: '/deployments/acme-platform', ready: 'table, .card-list' },
  { name: 'changelogs', path: '/changelogs/acme-platform', ready: '.page-head' },
  { name: 'users', path: '/settings/users', ready: 'table, .card-list' },
  { name: 'sources', path: '/settings/sources', ready: '.source-row' },
  { name: 'settings-general', path: '/settings', ready: '.blocks' },
  // The widest table the settings hold: six columns of what is in flight.
  { name: 'settings-jobs', path: '/settings/jobs', ready: 'table.data, .card-list' },
  { name: 'account', path: '/account', ready: '.account-head' },
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
