import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILTER_DEBOUNCE_MS } from './hooks';
import { overviewCodec, useUrlQuery, type UrlCodec } from './urlQuery';

const codec: UrlCodec<{ q: string }> = {
  parse: (params) => ({ q: params.get('q') ?? '' }),
  serialize: (value) => {
    const params = new URLSearchParams();
    if (value.q) params.set('q', value.q);
    return params;
  },
};

/** The hook's return, reached from outside the tree it lives in. */
let bound: ReturnType<typeof useUrlQuery<{ q: string }>>;

function Probe() {
  bound = useUrlQuery(codec);
  return <span data-testid="q">{bound.query.q}</span>;
}

function setup(entries = ['/page']) {
  const router = createMemoryRouter([{ path: '/page', element: <Probe /> }], {
    initialEntries: entries,
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** Lets the debounce elapse, then the effects it releases. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(FILTER_DEBOUNCE_MS + 10);
  });
}

const search = (router: ReturnType<typeof createMemoryRouter>) =>
  router.state.location.search;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useUrlQuery', () => {
  it('reads the filters out of the address it was opened at', () => {
    setup(['/page?q=prod']);
    expect(screen.getByTestId('q')).toHaveTextContent('prod');
  });

  it('writes a settled filter into the address', async () => {
    const router = setup();
    act(() => bound.setQuery({ q: 'prod' }));
    await settle();
    expect(search(router)).toBe('?q=prod');
  });

  it('makes one history entry out of a burst of changes', async () => {
    // Repos ticked one at a time is one intention, not five steps to walk back
    // through.
    const router = setup();
    act(() => bound.setQuery({ q: 'a' }));
    act(() => bound.setQuery({ q: 'ab' }));
    act(() => bound.setQuery({ q: 'abc' }));
    await settle();

    expect(search(router)).toBe('?q=abc');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(search(router)).toBe('');
  });

  it('restores the filters when the browser goes back', async () => {
    const router = setup();
    act(() => bound.setQuery({ q: 'first' }));
    await settle();
    act(() => bound.setQuery({ q: 'second' }));
    await settle();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByTestId('q')).toHaveTextContent('first');
  });

  it('does not answer its own echo', async () => {
    // Writing the address must not read back as an external change, or the two
    // directions push each other for ever.
    const router = setup();
    act(() => bound.setQuery({ q: 'prod' }));
    await settle();
    await settle();

    expect(search(router)).toBe('?q=prod');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(search(router)).toBe('');
  });

  it('amends the address for a choice the page made, rather than adding to it', async () => {
    // A default nobody asked for is not a step anybody meant to take.
    const router = setup();
    act(() => bound.replaceQuery({ q: 'default' }));
    await settle();
    expect(search(router)).toBe('?q=default');

    await act(async () => {
      await router.navigate(-1);
    });
    // Nowhere to go back to: the entry was replaced, not stacked.
    expect(search(router)).toBe('?q=default');
  });

  it('leaves an untouched page with a bare address', async () => {
    const router = setup();
    await settle();
    expect(search(router)).toBe('');
  });
});

describe('overviewCodec', () => {
  const read = (search: string) => overviewCodec.parse(new URLSearchParams(search));
  const write = (state: Parameters<typeof overviewCodec.serialize>[0]) =>
    overviewCodec.serialize(state).toString();

  it('leaves the fold to the board when nobody has chosen', () => {
    expect(read('').groupBy).toBeUndefined();
  });

  it('tells a chosen flat board from an unchosen one', () => {
    // Both look like "no fold" on screen; only one should survive a reload.
    expect(read('groupBy=').groupBy).toBe('');
    expect(write({ filters: {}, groupBy: '' })).toBe('groupBy=');
  });

  it('carries the dimension the board folds on', () => {
    expect(read('groupBy=client').groupBy).toBe('client');
    expect(write({ filters: {}, groupBy: 'client' })).toBe('groupBy=client');
  });

  it('takes both axes or neither', () => {
    // Half a crossing is not a choice, and would leave the matrix to invent
    // the other half on every load.
    expect(read('rows=client&columns=app').axes).toEqual({ rows: 'client', columns: 'app' });
    expect(read('rows=client').axes).toBeUndefined();
  });

  it('keeps the filters apart from the layout', () => {
    const state = read('dimension=type:prod&meta=production&groupBy=client');
    expect(state.filters).toMatchObject({ dimensions: { type: 'prod' }, meta: 'production' });
    expect(state.groupBy).toBe('client');
  });
});
