import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a page has to do to survive a narrow screen.
 *
 * jsdom computes no layout, so nothing in these suites can see a page overflow
 * — the 200-odd tests beside this one all pass on a page that is broken at
 * 360px. What *is* checkable is the handful of contracts the stylesheet relies
 * on: it can only contain a table it recognises, and it can only fold a
 * navigation that exists once.
 *
 * This is deliberately a source-level check rather than a rendered one. It
 * catches the regression that actually happens — a new page written on a wide
 * monitor, shipping markup the responsive rules do not reach — and it catches
 * it in the file where it was written.
 *
 * It is not a substitute for measuring. `npm run test:layout -w @repo/front`
 * loads the real pages in a real engine at 360, 768 and 1440 and fails on a
 * document wider than its window — that is where a responsive rule is proven,
 * and it is the only place in the repository with a browser in it.
 */

/** Vitest runs from the package root, which is what the paths below hang off. */
const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Every .tsx under src, since a page can live anywhere under it. */
function componentFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.spec.tsx')
      ? [path]
      : [];
  });
}

const FILES = componentFiles().map((path) => ({
  path: path.slice(SRC.length + 1),
  source: readFileSync(path, 'utf8'),
}));

describe('layout contract', () => {
  it('finds the components it is meant to be checking', () => {
    // A traversal that silently returned nothing would make every assertion
    // below vacuously true, which is worse than having no suite at all.
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('leaves the tables to the one component that renders both layouts', () => {
    // A table written by hand is a table that exists at 360px, where six
    // columns are dragged sideways rather than read. DataList is what turns a
    // set of columns into a table on a wide screen and a card list on a phone,
    // so a page reaching for <table> itself is a page that has only one of the
    // two — and nothing else in these suites would notice.
    const handWritten = FILES.filter(
      ({ path, source }) => path !== 'DataList.tsx' && source.includes('<table'),
    );
    expect(handWritten.map(({ path }) => path)).toEqual([]);
  });

  it('writes each section down once', () => {
    // The strip and the drawer are the same element, folded by the stylesheet.
    // A second copy of the links — the shape a mobile menu is usually given —
    // would be a list to keep in step, and two of every section for anybody
    // reading the document rather than looking at it.
    //
    // The settings rail is a navigation of its own and is none of this test's
    // business: what is checked is the sections, not the <nav> elements.
    const SECTIONS = [
      'nav.overview',
      'nav.dora',
      'nav.deployments',
      'nav.changelogs',
      'nav.releaseNotes',
    ];
    const duplicated = SECTIONS.flatMap((key) => {
      const holders = FILES.filter(({ source }) => source.includes(`'${key}'`)).map((f) => f.path);
      return holders.length === 1 && holders[0] === 'MainNav.tsx' ? [] : [`${key}: ${holders}`];
    });
    expect(duplicated).toEqual([]);
  });

  it('states a viewport, without which none of the rules apply', () => {
    // A page missing it is rendered at desktop width and scaled down: every
    // breakpoint below is dead, and nothing about the CSS would look wrong.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<meta\s+name="viewport"[^>]*width=device-width/);
  });
});
