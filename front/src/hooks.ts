import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorInfo, isAbort } from './api';

/**
 * How long a filter has to stay still before its value is fetched. Ticking
 * repos one at a time emits a state per click, and each one is a full round of
 * connector calls — waiting for the burst to end turns them into one request.
 */
export const FILTER_DEBOUNCE_MS = 500;

/**
 * Holds a value back until it stops changing for `delay` ms. The first value
 * passes straight through, so the initial load is never delayed.
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/**
 * Runs `load` on mount and on every `load` identity change, cancelling the
 * request it supersedes — so a page only ever renders the answer to its latest
 * question, and a view being left leaves nothing running behind it.
 *
 * `load` receives the signal to hand down to the API calls, and **must** be
 * memoized on what it reads: it is the dependency that decides when to refetch.
 * Errors are translated here; an aborted run reports nothing at all — neither
 * an error nor the end of loading, which belongs to the run replacing it.
 */
/**
 * How often a screen left open brings itself up to date. Matched to the
 * default collection cron rather than to a round number: refreshing faster
 * than the data is collected spends connector calls to redraw the same figures.
 */
export const AUTO_REFRESH_MS = 15 * 60 * 1000;

/**
 * How often a wall screen brings itself up to date.
 *
 * Tighter than a desk, because nobody there will ever press Refresh: what this
 * bounds is the lag between a collection landing and the wall showing it. Not
 * tighter still, because a live source pays a full round of connector calls
 * for every poll — only a stored one gets away with a database read.
 */
export const WALL_REFRESH_MS = 5 * 60 * 1000;

/**
 * Re-runs `reload` on a timer, but only while the tab is being looked at. A
 * dashboard left open in a background tab for a week is otherwise a week of
 * API calls nobody read — and the quota it spends is the one the collection
 * needs.
 *
 * Coming back to the tab reloads at once: the figures on screen are as old as
 * the time spent away, and waiting out the interval to say so is the wrong way
 * round.
 */
export function useAutoRefresh(reload: () => void, intervalMs = AUTO_REFRESH_MS): void {
  const latest = useRef(reload);
  latest.current = reload;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => latest.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        latest.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}

export function useCancellableLoad(load: (signal: AbortSignal) => Promise<void>) {
  const { t } = useTranslation();
  const inFlight = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    inFlight.current?.abort();
    const { signal } = (inFlight.current = new AbortController());
    setLoading(true);
    setError(null);
    try {
      await load(signal);
    } catch (e) {
      if (isAbort(e)) return;
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    } finally {
      // A superseded run must not clear the flag its replacement just set.
      if (!signal.aborted) setLoading(false);
    }
  }, [load, t]);

  useEffect(() => {
    void reload();
    return () => inFlight.current?.abort();
  }, [reload]);

  return { reload, loading, error };
}

/**
 * The width below which a page is laid out as a phone rather than as a table.
 *
 * Stated once, in the stylesheet's terms: the components that render two
 * different things read it, and the CSS that folds the rest matches it. Two
 * numbers drifting apart would give a page a card list and a desktop top bar.
 */
export const NARROW_PX = 640;

/**
 * Whether the window is narrow enough to be read as a phone.
 *
 * Some layouts cannot be reached from CSS: a table scrolled sideways is not a
 * list of cards, whatever is done to it, and rendering both and hiding one
 * would put every row in the document twice — twice for a screen reader, twice
 * for anybody searching the page. So the component picks, and this is what it
 * picks on.
 */
export function useNarrow(): boolean {
  const query = `(max-width: ${NARROW_PX}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    // Read again on subscribe: the width may have changed between the first
    // render and this effect — a rotation, or a devtools pane opening.
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return narrow;
}
