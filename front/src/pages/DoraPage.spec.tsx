import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DoraReport, DoraResult } from '@repo/shared';
import { DoraPage } from './DoraPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { dora: vi.fn(), metricSeries: vi.fn() },
}));

const { api } = await import('../api');

function result(over: Partial<DoraResult> = {}): DoraResult {
  return {
    metric: 'lead_time',
    value: 24_000,
    unit: 'seconds',
    dimensions: {},
    sampleSize: 30,
    samples: [],
    ...over,
  };
}

function report(over: Partial<DoraReport> = {}): DoraReport {
  return {
    results: [result(), result({ metric: 'deployment_frequency', value: 126, unit: 'count' })],
    repos: ['acme/api'],
    dimensions: { client: ['acme', 'globex'], type: ['prod', 'preprod'] },
    period: { from: '2026-07-01T00:00:00Z', to: '2026-07-31T00:00:00Z', windowDays: 30 },
    truncated: [],
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DoraPage sourceId="src-1" slug="acme" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.dora).mockReset();
  vi.mocked(api.metricSeries).mockReset();
  vi.mocked(api.metricSeries).mockResolvedValue([]);
});

describe('DoraPage', () => {
  it('shows one block per metric, with no dimension breakdown on it', async () => {
    // The filter bar states the scope; repeating a combination on the block
    // would claim the reading is about that one slice.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();

    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(document.querySelectorAll('.pill.attr')).toHaveLength(0);
  });

  it('explains a metric without opening its detail', async () => {
    // The help button sits inside a card that is itself a link target. Nested
    // in the anchor it was unreachable: every press navigated away.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    const card = screen.getByText('dora.metric.lead_time').closest('section')!;
    await userEvent.click(within(card).getByRole('button', { name: 'common.help' }));

    expect(within(card).getByRole('tooltip')).toHaveTextContent('dora.help.lead_time');
    // Still on the list: the tip explains, it does not navigate.
    expect(screen.getByText('dora.metric.deployment_frequency')).toBeInTheDocument();
  });

  it('closes the explanation on Escape', async () => {
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    const card = screen.getByText('dora.metric.lead_time').closest('section')!;
    await userEvent.click(within(card).getByRole('button', { name: 'common.help' }));
    await userEvent.keyboard('{Escape}');

    expect(within(card).queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hides the block of a metric nothing was computed for', async () => {
    // The filters narrow what is visible as well as what each block says.
    vi.mocked(api.dora).mockResolvedValue(report({ results: [result()] }));
    renderPage();

    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());
    expect(screen.queryByText('dora.metric.mttr')).not.toBeInTheDocument();
  });

  it('hands the filters in effect to the block it opens', async () => {
    // A detail computed over another period is a different number.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('client', { exact: false }), 'acme');
    await waitFor(() =>
      expect(vi.mocked(api.dora).mock.calls.at(-1)?.[1]).toMatchObject({
        dimensions: { client: 'acme' },
      }),
    );

    const link = screen.getByLabelText('dora.detail.openMetric:{"metric":"dora.metric.lead_time"}');
    expect(link.getAttribute('href')).toContain('dimension=client%3Aacme');
    expect(link.getAttribute('href')).toContain('/dora/acme/lead_time');
  });

  it('offers the value a narrowed dimension could widen back to', async () => {
    // The vocabulary is computed before slicing, on the server.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    const client = screen.getByLabelText('client', { exact: false });
    await userEvent.selectOptions(client, 'acme');
    expect(within(client).getByRole('option', { name: 'globex' })).toBeInTheDocument();
  });
});

/**
 * The line beside each value.
 *
 * It used to be folded here, from the raw snapshot list: every combination
 * matching the filter was appended end to end, so three combinations gave three
 * values for one day, drawn as three moments of a line that never moved. And it
 * read the whole table, ignoring the period the value beside it was computed
 * over. The server folds and bounds it now, with the code the metric page's own
 * chart already used.
 */
describe('the sparkline beside each value', () => {
  const series = (metric: string, points: number[]) => ({
    metric,
    dimensions: {},
    bucket: 'day' as const,
    snapshotCount: points.length,
    points: points.map((value, i) => ({ at: `2026-07-2${i}T00:00:00.000Z`, value })),
  });

  const cardOf = (metric: string) => screen.getByText(`dora.metric.${metric}`).closest('section')!;

  it('asks for every metric of the list at once', async () => {
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    expect(api.metricSeries).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.metricSeries).mock.calls[0][1].metrics).toContain('lead_time');
  });

  it('reads it over the slice the values are computed on', async () => {
    // A line drawn over every combination beside a value narrowed to one is
    // two readings with nothing in common.
    vi.mocked(api.dora).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('client', { exact: false }), 'acme');

    await waitFor(() =>
      expect(vi.mocked(api.metricSeries).mock.calls.at(-1)?.[1]).toMatchObject({
        dimensions: { client: 'acme' },
      }),
    );
  });

  it('plots one point per bucket the server folded', async () => {
    vi.mocked(api.dora).mockResolvedValue(report());
    vi.mocked(api.metricSeries).mockResolvedValue([series('lead_time', [10, 30, 20])]);
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    const line = cardOf('lead_time').querySelector('.spark-line')!;
    expect(line.getAttribute('points')!.split(' ')).toHaveLength(3);
  });

  it('draws nothing for a metric the history says nothing about', async () => {
    vi.mocked(api.dora).mockResolvedValue(report());
    vi.mocked(api.metricSeries).mockResolvedValue([series('lead_time', [])]);
    renderPage();
    await waitFor(() => expect(screen.getByText('dora.metric.lead_time')).toBeInTheDocument());

    expect(cardOf('lead_time').querySelector('.spark-line')).toBeNull();
    expect(within(cardOf('lead_time')).getByText('—')).toBeInTheDocument();
  });
});
