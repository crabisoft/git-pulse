import type { DoraQuery } from './api';

/**
 * The DORA filters, carried in a URL.
 *
 * The metric page has to read exactly the report the list was showing — a value
 * computed over another period is a different number — so the filters travel
 * with the link rather than being re-picked on arrival. Same spelling as the
 * API takes them, so there is one convention to remember rather than two.
 */
export function toSearchParams(query: DoraQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.windowDays !== undefined) params.set('windowDays', String(query.windowDays));
  for (const repo of query.repos ?? []) params.append('repos', repo);
  for (const [key, value] of Object.entries(query.dimensions ?? {})) {
    params.append('dimension', `${key}:${value}`);
  }
  return params;
}

/**
 * The same, as the DORA pages read them: a period and a dimension slice, never
 * a repo scope.
 *
 * The DORA pages have no repo filter, and dropping one arriving by hand-edited
 * URL is what keeps them honest. A value narrowed to two repos would sit above
 * a trend drawn from every repo — the snapshots record a metric and its
 * dimensions, never which repo it came from, so no history can be narrowed
 * that way. Reporting over everything is the only reading the two agree on.
 *
 * The overview keeps its own repo filter and its own reading, which is why the
 * scope stays in the vocabulary above rather than being removed from it.
 */
export function fromDoraParams(params: URLSearchParams): DoraQuery {
  const { repos: _scope, ...rest } = fromSearchParams(params);
  return rest;
}

/** The reverse, for a page that was linked to rather than navigated from. */
export function fromSearchParams(params: URLSearchParams): DoraQuery {
  const windowDays = params.get('windowDays');
  const dimensions: Record<string, string> = {};
  for (const pair of params.getAll('dimension')) {
    const separator = pair.indexOf(':');
    if (separator > 0) dimensions[pair.slice(0, separator)] = pair.slice(separator + 1);
  }

  return {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    windowDays: windowDays === null ? undefined : Number(windowDays),
    repos: params.getAll('repos'),
    dimensions,
  };
}
