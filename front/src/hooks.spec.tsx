import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILTER_DEBOUNCE_MS, useCancellableLoad, useDebounced } from './hooks';

describe('useDebounced', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the first value through, so the initial load is never delayed', () => {
    const { result } = renderHook(() => useDebounced('a', FILTER_DEBOUNCE_MS));
    expect(result.current).toBe('a');
  });

  it('holds a change back until it stops moving', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 500), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    act(() => void vi.advanceTimersByTime(499));
    expect(result.current).toBe('a');

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe('b');
  });

  it('emits only the last value of a burst', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 500), {
      initialProps: { value: 'a' },
    });

    // Ticking repos one at a time: each restarts the wait.
    for (const value of ['b', 'c', 'd']) {
      rerender({ value });
      act(() => void vi.advanceTimersByTime(200));
    }
    expect(result.current).toBe('a');

    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toBe('d');
  });
});

describe('useCancellableLoad', () => {
  it('runs the load on mount and clears the flag when it settles', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCancellableLoad(load));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('cancels the request a new load supersedes', async () => {
    const signals: AbortSignal[] = [];
    // A distinct function each time: a changed filter gives the hook a new
    // identity, which is what makes it drop the run in flight.
    const recorder = () => async (signal: AbortSignal) => {
      signals.push(signal);
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    const { result, rerender } = renderHook(({ fn }) => useCancellableLoad(fn), {
      initialProps: { fn: recorder() },
    });
    // Wait for the first run to be under way: superseding something that has
    // not started yet would prove nothing.
    await waitFor(() => expect(signals.length).toBe(1));

    rerender({ fn: recorder() });
    await waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('leaves the loading flag to whichever run replaced it', async () => {
    // The race the guard exists for: the superseded run's `finally` fires after
    // its replacement has already set loading, and must not clear it.
    let releaseFirst: () => void = () => {};
    const first = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ fn }) => useCancellableLoad(fn), {
      initialProps: { fn: first },
    });

    rerender({ fn: vi.fn(async () => new Promise<void>(() => {})) });
    await act(async () => {
      releaseFirst();
    });

    expect(result.current.loading).toBe(true);
  });

  it('reports a failure through the translated code', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCancellableLoad(load));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // `t` is stubbed to echo its key, so this asserts the code, not the wording.
    expect(result.current.error).toContain('errors.network');
    expect(result.current.loading).toBe(false);
  });

  it('says nothing when a load was cancelled rather than failed', async () => {
    const load = vi.fn(async (signal: AbortSignal) => {
      signal.throwIfAborted();
      throw new DOMException('aborted', 'AbortError');
    });
    const { result } = renderHook(() => useCancellableLoad(load));

    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
  });

  it('cancels on unmount, leaving nothing running for a dead view', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const { unmount } = renderHook(() => useCancellableLoad(load));
    await waitFor(() => expect(signals.length).toBe(1));
    unmount();

    expect(signals[0].aborted).toBe(true);
  });
});
