import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DashboardEnvironment,
  OverviewDirection,
  OverviewReport,
  PipelineStatus,
} from '@repo/shared';
import { OverviewPage } from './OverviewPage';
import { AVAILABLE_DIRECTIONS } from '../display';
import { FILTER_DEBOUNCE_MS } from '../hooks';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { overview: vi.fn(), live: vi.fn(), incidents: vi.fn() },
}));

const { api } = await import('../api');

const onDirectionChange = vi.fn();

/** The flow rows link to the metric pages, so the page needs a router around it. */
function renderPage(direction: OverviewDirection = 'control', entries = ['/dashboard/acme']) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <OverviewPage
        sourceId="src-1"
        slug="acme"
        staleHours={72}
        direction={direction}
        onDirectionChange={onDirectionChange}
      />
    </MemoryRouter>,
  );
}

function env(
  name: string,
  attributes: Record<string, string>,
  lastStatus: PipelineStatus = 'success',
): DashboardEnvironment {
  return {
    name,
    attributes,
    metaEnvironments: ['production'],
    repos: ['acme/api'],
    deployments: 4,
    lastDeployAt: '2026-07-30T10:00:00.000Z',
    lastStatus,
    ref: 'v2.14.1',
    recent: ['success', 'failed', 'success'],
  };
}

function report(over: Partial<OverviewReport> = {}): OverviewReport {
  return {
    sourceId: 'src-1',
    environments: [
      env('prod-acme-api', { type: 'prod', client: 'acme', app: 'api' }),
      env('prod-globex-api', { type: 'prod', client: 'globex', app: 'api' }, 'failed'),
    ],
    dimensions: { app: ['api'], client: ['acme', 'globex'], type: ['prod'] },
    metaEnvironments: ['production'],
    repos: ['acme/api'],
    flow: [
      {
        metric: 'deployment_frequency',
        value: 126,
        unit: 'count',
        sampleSize: 126,
        trend: [2, 3, 4.2],
        delta: 0.18,
        improving: true,
      },
    ],
    friction: {
      openPrs: 18,
      stalePrs: 6,
      failedPipelines: 3,
      runningPipelines: 2,
      reviewTimeSec: 100_800,
    },
    health: {
      mode: 'stored',
      syncedAt: '2026-07-30T09:46:00.000Z',
      staleForSec: 840,
      queues: 'ok',
      quotaLeft: 0.42,
    },
    events: [],
    period: { from: '2026-07-01T00:00:00Z', to: '2026-07-30T00:00:00Z', windowDays: 30 },
    warnings: [],
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(api.overview).mockReset();
  vi.mocked(api.live).mockReset();
  vi.mocked(api.incidents).mockReset();
  vi.mocked(api.incidents).mockResolvedValue([]);
  onDirectionChange.mockReset();
});

describe('OverviewPage', () => {
  it('builds one filter per dimension the rules produced', async () => {
    // Nothing is written in the page: adding a rule has to add a control.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();

    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());
    for (const key of ['app', 'client', 'type']) {
      expect(screen.getByLabelText(key, { exact: false })).toBeInTheDocument();
    }
  });

  it('narrows on a dimension without losing the value it could widen back to', async () => {
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    const client = screen.getByLabelText('client', { exact: false });
    await userEvent.selectOptions(client, 'acme');

    // The vocabulary comes from the unfiltered set, so globex is still offered.
    expect(within(client).getByRole('option', { name: 'globex' })).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(api.overview).mock.calls.at(-1)?.[1]).toMatchObject({
        dimensions: { client: 'acme' },
      }),
    );
  });

  it('folds the board on the dimension asked for', async () => {
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    await userEvent.selectOptions(
      screen.getByLabelText('overview.filters.groupBy', { exact: false }),
      'client',
    );

    // Scoped to the board: the same words are also options in the filter above.
    const headings = [...document.querySelectorAll('.group-head')].map(
      (node) => node.firstChild?.textContent,
    );
    expect(headings).toEqual(['acme', 'globex']);

    // Folding rearranges what is already loaded. Waited out past the debounce
    // rather than asserted on the spot: the filters travel in the address now,
    // and a fold that slipped in among them would only reload once it settled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FILTER_DEBOUNCE_MS + 100));
    });
    expect(vi.mocked(api.overview)).toHaveBeenCalledOnce();
  });

  it('names the attribute an environment is missing rather than dropping it', async () => {
    vi.mocked(api.overview).mockResolvedValue(
      report({ environments: [env('qa-web', { type: 'qa' })] }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('qa-web')).toBeInTheDocument());
    expect(screen.getAllByText('overview.unclassified').length).toBeGreaterThan(0);
  });

  it('says how stale the reading is, and how the collection is doing', async () => {
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/overview.health.synced/)).toBeInTheDocument(),
    );
    expect(screen.getByText('overview.health.queues.ok')).toBeInTheDocument();
  });

  it('shows a visitor no queue state, because the API sent none', async () => {
    vi.mocked(api.overview).mockResolvedValue(
      report({
        health: {
          mode: 'stored',
          syncedAt: '2026-07-30T09:46:00.000Z',
          staleForSec: 840,
          queues: null,
          quotaLeft: null,
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());
    expect(screen.queryByText(/overview.health.queues/)).not.toBeInTheDocument();
    expect(screen.queryByText(/overview.health.quota/)).not.toBeInTheDocument();
  });

  it('switches the reading from the page, without a settings detour', async () => {
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByTitle('display.directionLabel'), 'instrument');

    expect(onDirectionChange).toHaveBeenCalledWith('instrument');
    // Presentation is not data: it must not cost a request.
    expect(vi.mocked(api.overview)).toHaveBeenCalledOnce();
  });

  it('leaves light and dark to the bar', async () => {
    // The switch lives in the top bar, on this page as on every other. A second
    // one here asked the same question twice, in a shape of its own.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'display.mode.dark' })).not.toBeInTheDocument();
  });

  it('offers no direction this build cannot render', async () => {
    // Selecting one would leave the reader on a page that draws nothing, so
    // the control offers exactly what is wired — no more, and no less.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    const picker = screen.getByTitle('display.directionLabel');
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[];
    const usable = options.filter((option) => !option.disabled).map((option) => option.value);
    expect(usable).toEqual([...AVAILABLE_DIRECTIONS]);
  });

  it('leaves the exhaustive lists unfetched until one is opened', async () => {
    // The whole point of the summary: most visits never need the lists, and
    // each one is a full round of connector calls.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage();
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    expect(vi.mocked(api.live)).not.toHaveBeenCalled();
  });

  it('crosses the environments on two dimensions in the instrument panel', async () => {
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage('instrument');

    await waitFor(() => expect(screen.getByText('overview.matrix.title')).toBeInTheDocument());
    // Both refs land in the grid, one per client, under the api column.
    expect(screen.getAllByText('v2.14.1')).toHaveLength(2);
    // 126 deployments over a 30-day window is 4.2 a day: the tier is read from
    // the rate the bands are published in, not from the raw count.
    expect(screen.getByText('dora.tier.elite')).toBeInTheDocument();
  });

  it('says how many environments a crossing is standing in front of', async () => {
    // Crossing type × app collapses the client: without a word, picking those
    // axes would show one of the two and hide the other.
    vi.mocked(api.overview).mockResolvedValue(
      report({ dimensions: { app: ['api'], type: ['prod', 'preprod'] } }),
    );
    renderPage('instrument');

    await waitFor(() => expect(screen.getByText('overview.matrix.title')).toBeInTheDocument());
    // One shown, one behind it — and the badge names what it is hiding.
    expect(screen.getByText(/overview\.matrix\.more/)).toHaveTextContent('"count":1');
    expect(screen.getByTitle(/prod-acme-api/)).toBeInTheDocument();
  });

  it('says what is missing rather than drawing an empty grid', async () => {
    // One dimension cannot be crossed with itself.
    vi.mocked(api.overview).mockResolvedValue(report({ dimensions: { type: ['prod'] } }));
    renderPage('instrument');

    await waitFor(() => expect(screen.getByText('overview.matrix.needsTwo')).toBeInTheDocument());
  });

  it('reads incidents only where they are shown', async () => {
    // They come from a tracker on another platform, with a budget of its own.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage('control');
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());
    expect(vi.mocked(api.incidents)).not.toHaveBeenCalled();

    cleanup();
    renderPage('stream');
    await waitFor(() => expect(vi.mocked(api.incidents)).toHaveBeenCalledOnce());
  });

  it('strips everything meant to be operated on a wall screen', async () => {
    // Nobody is standing at it: no filter bar, no Refresh, no folded lists,
    // and no help buttons that only answer to a pointer.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage('control', ['/dashboard/acme?wall']);
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    expect(screen.queryByText('common.refresh', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('client', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText('overview.details.prs')).not.toBeInTheDocument();
    expect(screen.getByText('overview.wall.exit')).toBeInTheDocument();
  });

  it('keeps the scope on the way in and out of a wall', async () => {
    // The address is what states what the monitor shows; turning the mode on
    // must not quietly widen it back to everything.
    vi.mocked(api.overview).mockResolvedValue(report());
    renderPage('control', ['/dashboard/acme?dimension=type%3Aprod']);
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    const enter = screen.getByText('overview.wall.enter');
    expect(enter.getAttribute('href')).toContain('dimension=type%3Aprod');
    expect(enter.getAttribute('href')).toContain('wall');

    cleanup();
    renderPage('control', ['/dashboard/acme?dimension=type%3Aprod&wall']);
    await waitFor(() => expect(screen.getByText('prod-acme-api')).toBeInTheDocument());

    const exit = screen.getByText('overview.wall.exit');
    expect(exit.getAttribute('href')).toContain('dimension=type%3Aprod');
    expect(exit.getAttribute('href')).not.toContain('wall');
  });
});
