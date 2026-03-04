import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PipelineStatus } from '@repo/shared';
import type { ChangelogsQuery, DeploymentsQuery, DoraQuery, OverviewQuery } from './api';
import {
  fromDoraParams,
  fromSearchParams as doraFrom,
  toSearchParams as doraTo,
} from './doraQuery';
import { FILTER_DEBOUNCE_MS, useDebounced } from './hooks';
import { WALL_PARAM } from './wall';

/**
 * How a page's filters are written into its address, and read back out.
 *
 * The spelling is the API's own, so there is one convention to remember rather
 * than two — and an address can be pasted into a terminal as easily as into a
 * browser.
 */
export interface UrlCodec<T> {
  parse(params: URLSearchParams): T;
  serialize(query: T): URLSearchParams;
}

/**
 * Filters that live in the address bar.
 *
 * The state stays local so the controls answer immediately, and the address
 * follows the **settled** value — a burst of clicks, repos ticked one at a
 * time, becomes one history entry rather than five nobody wants to walk back
 * through. Going back or forward writes the address first, which is why the
 * traffic has to run both ways: whatever the address says then wins, and the
 * page re-reads it.
 *
 * What was last written is remembered so neither direction answers its own
 * echo, which is the loop this shape exists to avoid.
 */
export function useUrlQuery<T>(codec: UrlCodec<T>): {
  query: T;
  setQuery: Dispatch<SetStateAction<T>>;
  /**
   * Same as `setQuery`, but the address is amended rather than added to. For a
   * choice the page made on the reader's behalf — a first repo picked as soon
   * as the list is known — which has no business being a step to go back to.
   */
  replaceQuery: Dispatch<SetStateAction<T>>;
  /** Debounced — what to fetch on, and what the address mirrors. */
  settled: T;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<T>(() => codec.parse(searchParams));
  const settled = useDebounced(query, FILTER_DEBOUNCE_MS);
  const lastWritten = useRef(searchParams.toString());
  const replaceNext = useRef(false);

  const replaceQuery: Dispatch<SetStateAction<T>> = useCallback((next) => {
    replaceNext.current = true;
    setQuery(next);
  }, []);

  const serialized = codec.serialize(settled).toString();
  useEffect(() => {
    if (serialized === lastWritten.current) return;
    lastWritten.current = serialized;
    // A new entry rather than a replacement: the point is to be able to walk
    // back to the filter you had a moment ago.
    setSearchParams(serialized, { replace: replaceNext.current });
    replaceNext.current = false;
  }, [serialized, setSearchParams]);

  const current = searchParams.toString();
  useEffect(() => {
    if (current === lastWritten.current) return;
    // The address changed under us — back, forward, or a link somebody sent.
    lastWritten.current = current;
    setQuery(codec.parse(new URLSearchParams(current)));
  }, [current]);

  return { query, setQuery, replaceQuery, settled };
}

/** Repeated parameters, as every list filter writes them. */
function readList(params: URLSearchParams, key: string): string[] {
  return params.getAll(key);
}

function writeList(params: URLSearchParams, key: string, values: readonly string[] = []): void {
  for (const value of values) params.append(key, value);
}

/**
 * Period and dimension slice. No repo scope: see `fromDoraParams` — a value
 * narrowed to a repo would sit above a trend that cannot be.
 */
export const doraCodec: UrlCodec<DoraQuery> = {
  parse: fromDoraParams,
  serialize: doraTo,
};

/**
 * What the overview is looking at, layout included.
 *
 * The fold and the matrix axes shape the reading rather than narrowing it, but
 * losing them on a back is exactly as jarring as losing a filter: you left a
 * board folded by client and came back to a flat one. They travel with the
 * rest, and never reach the API — `api.overview` names the fields it sends.
 */
export interface OverviewState {
  /**
   * What narrows the report. Kept in a nested object of its own so that
   * changing the layout leaves its identity untouched — the page reloads on
   * this and nothing else, and refolding a board it already holds must not
   * cost a round of connector calls.
   */
  filters: OverviewQuery;
  /**
   * Which dimension the board folds on. Absent means nobody has chosen and the
   * board proposes one; an empty string is a choice — flat, on purpose.
   */
  groupBy?: string;
  /** Which dimensions the matrix crosses. Absent means it proposes a pair. */
  axes?: { rows: string; columns: string };
  /**
   * Read as a wall screen. Carried here so that changing a filter does not
   * quietly hand the monitor back its navigation bar — every rewrite of the
   * address goes through this codec.
   */
  wall?: boolean;
}

export const overviewCodec: UrlCodec<OverviewState> = {
  parse: (params) => {
    const rows = params.get('rows');
    const columns = params.get('columns');
    return {
      filters: { ...doraFrom(params), meta: params.get('meta') ?? '' },
      // `has` and not the value: an empty `groupBy` is "flat by choice", which
      // an absent one is not. Empty rather than a word like `none`, which a
      // capture group could legitimately be called.
      ...(params.has('groupBy') ? { groupBy: params.get('groupBy') ?? '' } : {}),
      // Half a crossing is not a choice; it takes both to override the pair
      // the matrix would have proposed.
      ...(rows && columns ? { axes: { rows, columns } } : {}),
      ...(params.has(WALL_PARAM) ? { wall: true } : {}),
    };
  },
  serialize: (query) => {
    const params = doraTo(query.filters);
    if (query.filters.meta) params.set('meta', query.filters.meta);
    if (query.groupBy !== undefined) params.set('groupBy', query.groupBy);
    if (query.axes) {
      params.set('rows', query.axes.rows);
      params.set('columns', query.axes.columns);
    }
    if (query.wall) params.set(WALL_PARAM, '');
    return params;
  },
};

/** Deployments: the DORA vocabulary, plus what only a list narrows on. */
export const deploymentsCodec: UrlCodec<DeploymentsQuery> = {
  parse: (params) => ({
    ...doraFrom(params),
    environments: readList(params, 'environment'),
    statuses: readList(params, 'status') as PipelineStatus[],
  }),
  serialize: (query) => {
    const params = doraTo(query);
    writeList(params, 'environment', query.environments);
    writeList(params, 'status', query.statuses);
    return params;
  },
};

/**
 * The changelog archive. No rolling window, unlike every other report: the
 * archive exists to be read months later, so an address with no period means
 * the whole history rather than the configured one.
 */
export const changelogsCodec: UrlCodec<ChangelogsQuery> = {
  parse: (params) => ({
    repos: readList(params, 'repo'),
    environments: readList(params, 'environment'),
    search: params.get('search') ?? '',
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  }),
  serialize: (query) => {
    const params = new URLSearchParams();
    writeList(params, 'repo', query.repos);
    writeList(params, 'environment', query.environments);
    if (query.search) params.set('search', query.search);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return params;
  },
};

/** What the release notes are generated over: one repo, between two refs. */
export interface ReleaseNotesRange {
  repo: string;
  from: string;
  to: string;
}

export const releaseNotesCodec: UrlCodec<ReleaseNotesRange> = {
  parse: (params) => ({
    repo: params.get('repo') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  }),
  serialize: (query) => {
    const params = new URLSearchParams();
    if (query.repo) params.set('repo', query.repo);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    return params;
  },
};
