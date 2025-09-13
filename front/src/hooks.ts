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
