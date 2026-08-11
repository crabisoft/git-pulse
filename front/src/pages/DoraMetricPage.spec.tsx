import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoraReport, DoraResult, DoraSample } from '@repo/shared';
import { DoraMetricPage } from './DoraMetricPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { dora: vi.fn(), metricSeries: vi.fn(), doraSamples: vi.fn() },
}));

const { api } = await import('../api');

function sample(label: string, value: number): DoraSample {
  return { label, at: '2026-07-30T10:00:00.000Z', value };
}

function result(over: Partial<DoraResult> = {}): DoraResult {
  return {
    metric: 'deploy_time',
    value: 120,
    unit: 'seconds',
    dimensions: {},
    sampleSize: 260,
    samples: [sample('api #1', 14_400), sample('api #2', 12_000)],
    ...over,
  };
}

function report(over: Partial<DoraReport> = {}): DoraReport {
  return {
    results: [result()],
    repos: ['acme/api'],
    dimensions: { client: ['acme', 'globex'], type: ['prod', 'preprod'] },
    period: { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z', windowDays: 30 },
    truncated: [],
    ...over,
  };
}

function renderPage(at = '/dora/acme/deploy_time') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/dora/:slug/:metric"
          element={<DoraMetricPage sourceId="src-1" slug="acme" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.metricSeries).mockResolvedValue([{ metric: 'deploy_time', points: [] }] as never);
  vi.mocked(api.doraSamples).mockResolvedValue({
    items: [sample('api #1', 14_400)],
    page: { total: 260, limit: 10, offset: 0, hasMore: true },
  });
});

describe('the chart beside the value', () => {
  it('is bounded by the same rolling window the value is', async () => {
    // A period picked from the presets carries no bounds. Sending only from/to
    // drew a line over every snapshot ever taken, beside a value covering the
    // window — two readings of nothing in common.
    vi.mocked(api.dora).mockResolvedValue(report());

    renderPage('/dora/acme/deploy_time?windowDays=90&dimension=type:Prod');

    await screen.findByText(/dora\.sample/);
    expect(api.metricSeries).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({ windowDays: 90, dimensions: { type: 'Prod' } }),
      expect.anything(),
    );
  });
});

describe('a reading that folds several combinations', () => {
  it('says how many it covers, so the value is not read as one slice', async () => {
    vi.mocked(api.dora).mockResolvedValue(report({ results: [result({ combinations: 3 })] }));

    renderPage();

    expect(await screen.findByText(/dora\.detail\.folded/)).toHaveTextContent('"count":3');
  });

  it('says nothing of the sort when the reading is one combination', async () => {
    vi.mocked(api.dora).mockResolvedValue(report({ results: [result({ combinations: 1 })] }));

    renderPage();

    await screen.findByText(/dora\.sample/);
    expect(screen.queryByText(/dora\.detail\.folded/)).not.toBeInTheDocument();
  });

  it('asks the server for the events, under the same filters as the value', async () => {
    // The reading carries its most recent few; a list somebody pages through
    // has to be the whole population, which only the server holds.
    vi.mocked(api.dora).mockResolvedValue(report());

    renderPage('/dora/acme/deploy_time?windowDays=180&dimension=App:Billing');

    await screen.findByText(/dora\.sample/);
    expect(api.doraSamples).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        metric: 'deploy_time',
        windowDays: 180,
        dimensions: { App: 'Billing' },
      }),
      expect.objectContaining({ offset: 0 }),
      expect.anything(),
    );
  });

  it('counts a page against the whole population, not against what it holds', async () => {
    vi.mocked(api.dora).mockResolvedValue(report());

    renderPage();

    // One row shown, 260 events behind it — and every one of them reachable.
    expect(await screen.findByText(/dora\.detail\.shown/)).toHaveTextContent('"total":260');
  });
});

/**
 * The filter bar, on the detail as much as on the list.
 *
 * Narrowing used to mean walking back, picking, and opening the same block
 * again — three steps to answer the question the page was already about.
 */
describe('the filters on a metric page', () => {
  it('recomputes the reading, its chart and its events under what was picked', async () => {
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await screen.findByText(/dora\.sample/);

    await userEvent.selectOptions(screen.getByLabelText('client', { exact: false }), 'globex');

    await waitFor(() => {
      expect(vi.mocked(api.dora).mock.calls.at(-1)?.[1]).toMatchObject({
        dimensions: { client: 'globex' },
      });
      expect(vi.mocked(api.metricSeries).mock.calls.at(-1)?.[1]).toMatchObject({
        dimensions: { client: 'globex' },
      });
      expect(vi.mocked(api.doraSamples).mock.calls.at(-1)?.[1]).toMatchObject({
        dimensions: { client: 'globex' },
      });
    });
  });

  it('hands what was picked back to the list', async () => {
    // Otherwise the way back undoes the narrowing, and the list disagrees with
    // the page it was opened from.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await screen.findByText(/dora\.sample/);

    await userEvent.selectOptions(screen.getByLabelText('client', { exact: false }), 'globex');

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /dora\.title/ }).getAttribute('href')).toContain(
        'dimension=client%3Aglobex',
      ),
    );
  });

  it('offers the value a narrowed dimension could widen back to', async () => {
    // The vocabulary is computed before slicing, on the server — so a filtered
    // report never hands back a bar that can only narrow further.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await screen.findByText(/dora\.sample/);

    const client = screen.getByLabelText('client', { exact: false });
    await userEvent.selectOptions(client, 'globex');

    expect(within(client).getByRole('option', { name: 'acme' })).toBeInTheDocument();
  });

  it('leaves the bar standing when the narrowed scope has no reading', async () => {
    // A page with nothing on it and no way to widen back is a dead end.
    vi.mocked(api.dora).mockResolvedValue(report({ results: [] }));
    renderPage();

    expect(await screen.findByText('dora.detail.gone')).toBeInTheDocument();
    expect(screen.getByLabelText('client', { exact: false })).toBeInTheDocument();
  });
});
