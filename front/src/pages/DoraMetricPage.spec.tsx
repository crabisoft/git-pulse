import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoraResult, DoraSample } from '@repo/shared';
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dora/acme/deploy_time']}>
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
    vi.mocked(api.dora).mockResolvedValue({ results: [result()] } as never);

    render(
      <MemoryRouter initialEntries={['/dora/acme/deploy_time?windowDays=90&dimension=type:Prod']}>
        <Routes>
          <Route
            path="/dora/:slug/:metric"
            element={<DoraMetricPage sourceId="src-1" slug="acme" />}
          />
        </Routes>
      </MemoryRouter>,
    );

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
    vi.mocked(api.dora).mockResolvedValue({ results: [result({ combinations: 3 })] } as never);

    renderPage();

    expect(await screen.findByText(/dora\.detail\.folded/)).toHaveTextContent('"count":3');
  });

  it('says nothing of the sort when the reading is one combination', async () => {
    vi.mocked(api.dora).mockResolvedValue({ results: [result({ combinations: 1 })] } as never);

    renderPage();

    await screen.findByText(/dora\.sample/);
    expect(screen.queryByText(/dora\.detail\.folded/)).not.toBeInTheDocument();
  });

  it('asks the server for the events, under the same filters as the value', async () => {
    // The reading carries its most recent few; a list somebody pages through
    // has to be the whole population, which only the server holds.
    vi.mocked(api.dora).mockResolvedValue({ results: [result()] } as never);

    render(
      <MemoryRouter initialEntries={['/dora/acme/deploy_time?windowDays=180&dimension=App:Billing']}>
        <Routes>
          <Route
            path="/dora/:slug/:metric"
            element={<DoraMetricPage sourceId="src-1" slug="acme" />}
          />
        </Routes>
      </MemoryRouter>,
    );

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
    vi.mocked(api.dora).mockResolvedValue({ results: [result()] } as never);

    renderPage();

    // One row shown, 260 events behind it — and every one of them reachable.
    expect(await screen.findByText(/dora\.detail\.shown/)).toHaveTextContent('"total":260');
  });
});
