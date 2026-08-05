import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DoraReport, DoraResult } from '@repo/shared';
import { DoraPage } from './DoraPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { dora: vi.fn(), metrics: vi.fn() },
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
  vi.mocked(api.metrics).mockReset();
  vi.mocked(api.metrics).mockResolvedValue({
    items: [],
    page: { total: 0, limit: 200, offset: 0, hasMore: false },
  });
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
