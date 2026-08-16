import { generatePath, matchPath } from 'react-router-dom';

/**
 * Routes the topbar picker drives. Switching source keeps you on the page you
 * were reading, so the pattern is needed as well as the slug.
 *
 * No settings route appears here: settings is an application-wide module.
 * Classification rules are a shared catalogue and ticket rules belong to their
 * tracker, so nothing under Settings is scoped to a source at all.
 */
const SOURCE_ROUTES = [
  '/dashboard/:slug',
  '/dora/:slug/:metric',
  '/dora/:slug',
  '/deployments/:slug/changes',
  '/deployments/:slug',
  '/changelogs/:slug',
  '/release-notes/:slug',
];

/** The source route the address is on, or null on the source-less pages. */
function matchSourceRoute(pathname: string) {
  for (const pattern of SOURCE_ROUTES) {
    const params = matchPath(pattern, pathname)?.params;
    if (params?.slug) return { pattern, params, slug: params.slug };
  }
  return null;
}

/** The slug the address names, or null where no page is scoped to a source. */
export function slugOf(pathname: string): string | null {
  return matchSourceRoute(pathname)?.slug ?? null;
}

/**
 * The period, spelled the same way by every page that has one. It means the
 * same thing whoever is reporting — a span of time — so it survives a change of
 * source, where the rest of the filters cannot: a dimension slice, a repo, an
 * environment are vocabulary the source defines, and carrying them over would
 * narrow the new one to values it may not have, or to none at all.
 */
const PERIOD_PARAMS = ['from', 'to', 'windowDays'];

/**
 * The same page over the same period, on another source — or null when the page
 * has no source to change. Every placeholder of the pattern is refilled from the
 * address, not just the slug: a sub-page such as `/dora/:slug/:metric` has more
 * than one, and leaving one out throws rather than navigating.
 */
export function samePageOn(pathname: string, slug: string, search = ''): string | null {
  const match = matchSourceRoute(pathname);
  if (!match) return null;

  const current = new URLSearchParams(search);
  const period = new URLSearchParams();
  for (const key of PERIOD_PARAMS) {
    const value = current.get(key);
    if (value !== null) period.set(key, value);
  }

  const path = generatePath(match.pattern, { ...match.params, slug });
  const query = period.toString();
  return query ? `${path}?${query}` : path;
}
