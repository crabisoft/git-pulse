import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DashboardEnvironment,
  OverviewDirection,
  OverviewEvent,
  OverviewReport,
  PipelineStatus,
} from '@repo/shared';
import { OverviewPage } from './OverviewPage';
import { AVAILABLE_DIRECTIONS } from '../display';
import { FILTER_DEBOUNCE_MS } from '../hooks';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { overview: vi.fn(), live: vi.fn(), incidents: vi.fn(), deployments: vi.fn() },
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
    declared: false,
    recent: ['success', 'failed', 'success'],
  };
}

function report(over: Partial<OverviewReport> = {}): OverviewReport {
  const environments = over.environments ?? [
    env('prod-acme-api', { type: 'prod', client: 'acme', app: 'api' }),
    env('prod-globex-api', { type: 'prod', client: 'globex', app: 'api' }, 'failed'),
  ];
  return {
    sourceId: 'src-1',
    environments,
    // What runs defaults to what the period held: a fixture that says nothing
    // about the difference is one where the two lists are the same.
    running: over.running ?? environments,
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
    // Empty by default, which is both what an install with no version rule
    // sends and what a visitor is shown whatever the rules say.
    versions: [],
    period: { from: '2026-07-01T00:00:00Z', to: '2026-07-30T00:00:00Z', windowDays: 30 },
    warnings: [],
    ...over,
  };
}

/**
 * A deployment on the recent-activity window, placed relative to now — the
 * journal and the frieze both cut on the clock, so a fixed date would age out
 * of every window the day after it was written.
 */
function event(hoursAgo: number, id = `gh:acme/api:${hoursAgo}`): OverviewEvent {
  return {
    id,
    at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    environment: 'prod-acme-api',
    repo: 'acme/api',
    ref: 'v2.14.1',
    status: 'success',
    url: 'https://example.test/deployments/1',
    attributes: { type: 'prod' },
  };
}

beforeEach(() => {
  vi.mocked(api.overview).mockReset();
  vi.mocked(api.live).mockReset();
  vi.mocked(api.incidents).mockReset();
  vi.mocked(api.incidents).mockResolvedValue([]);
  vi.mocked(api.deployments).mockReset();
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

  it('crosses what runs, not what moved inside the period', async () => {
    // The matrix answers "which version is live where"; a stable production
    // deployed before the period is exactly what it is looked at for.
    vi.mocked(api.overview).mockResolvedValue(
      report({
        environments: [env('prod-acme-api', { type: 'prod', client: 'acme', app: 'api' })],
        running: [
          env('prod-acme-api', { type: 'prod', client: 'acme', app: 'api' }),
          env('prod-globex-api', { type: 'prod', client: 'globex', app: 'api' }),
        ],
      }),
    );
    renderPage('instrument');

    await waitFor(() => expect(screen.getByTitle('prod-globex-api')).toBeInTheDocument());
    expect(screen.getByTitle('prod-acme-api')).toBeInTheDocument();
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

  it('draws the journal from the recent window the report carries', async () => {
    vi.mocked(api.overview).mockResolvedValue(
      report({ events: [event(3)] }),
    );
    renderPage('stream');

    // The rail names environments too, so the entry is looked for by its own
    // second line rather than by a name the page says twice.
    await waitFor(() =>
      expect(screen.getByText('acme/api · v2.14.1')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/overview\.stream\.empty/)).not.toBeInTheDocument();
    // The journal is a rail of the recent past, not a report over the period:
    // it costs no listing of its own.
    expect(vi.mocked(api.deployments)).not.toHaveBeenCalled();
  });

  it('names the window it covers when it has nothing to show', async () => {
    // The complaint this answers: "nothing on this scope over the period" on a
    // journal that never read the period reads as a broken filter. It says
    // which hours it looked at, and that the period is not one of them.
    vi.mocked(api.overview).mockResolvedValue(report({ events: [] }));
    renderPage('stream', ['/dashboard/acme?windowDays=60']);

    await waitFor(() =>
      expect(screen.getByText(/overview\.stream\.empty/)).toHaveTextContent('"hours":48'),
    );
  });

  it('keeps the frieze to the day it draws, whatever the report carries', async () => {
    // The report covers two days so the journal can show a Friday evening on a
    // Monday; the control room's axis is a day wide and would pile anything
    // older against its left edge.
    vi.mocked(api.overview).mockResolvedValue(
      report({
        events: [event(3), event(30, 'gh:acme/api:old')],
      }),
    );
    renderPage('control');

    await waitFor(() =>
      expect(screen.getByText(/overview\.events\.count/)).toHaveTextContent('"count":1'),
    );
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
