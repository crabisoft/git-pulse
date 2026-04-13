import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthState, EnvironmentVersion, OverviewReport } from '@repo/shared';
import { VersionsView } from './VersionsView';
import { DEFAULT_VERSION_AXES, type Axes } from './axes';

const auth: { state: AuthState | null } = { state: null };
vi.mock('../auth', () => ({ useAuth: () => auth }));

function signedIn(yes: boolean) {
  auth.state = {
    user: yes ? ({ id: 'u-1', role: 'user' } as AuthState['user']) : null,
    publicDashboard: true,
    setupRequired: false,
  };
}

function reading(over: Partial<EnvironmentVersion> = {}): EnvironmentVersion {
  return {
    repo: 'acme/api',
    environment: 'prod',
    version: '1.4.2',
    deploymentId: null,
    ref: 'v1.4.2',
    ruleId: 'vr-1',
    url: null,
    status: 'ok',
    error: null,
    attributes: {},
    metaEnvironments: [],
    observedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    changedAt: null,
    ...over,
  };
}

function renderView(
  versions: EnvironmentVersion[],
  options: {
    axes?: Axes;
    dimensions?: Record<string, string[]>;
    onAxesChange?: () => void;
    filtered?: boolean;
    onClearFilters?: () => void;
    onOpenHistory?: () => void;
  } = {},
) {
  const report = { versions, dimensions: options.dimensions ?? {} } as OverviewReport;
  return render(
    <MemoryRouter>
      <VersionsView
        report={report}
        slug="acme"
        axes={options.axes ?? DEFAULT_VERSION_AXES}
        onAxesChange={options.onAxesChange ?? vi.fn()}
        filtered={options.filtered ?? false}
        onClearFilters={options.onClearFilters ?? vi.fn()}
        onOpenHistory={options.onOpenHistory ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('who the grid is shown to', () => {
  it('says why it is empty for a visitor, rather than showing an empty grid', () => {
    signedIn(false);
    renderView([]);

    expect(screen.getByText(/overview.versions.signedOut/)).toBeInTheDocument();
    expect(screen.queryByText('overview.versions.empty')).toBeNull();
  });

  it('points a signed-in reader at the rules when nothing has been read', () => {
    signedIn(true);
    renderView([]);

    // Four empty states are four different facts: not signed in, no rule
    // written, nothing read yet, and everything filtered out.
    expect(screen.getByText(/overview.versions.empty/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'overview.versions.configure' })).toBeInTheDocument();
  });

  it('blames the filters rather than the rules when they are what emptied it', () => {
    signedIn(true);
    renderView([], { filtered: true });

    expect(screen.getByText(/overview.versions.filteredOut/)).toBeInTheDocument();
    // And not the other wording: sending somebody to write a rule they already
    // wrote is the whole reason these two states are told apart.
    expect(screen.queryByText(/overview.versions.empty/)).toBeNull();
  });

  it('offers the way back out of the filters', async () => {
    signedIn(true);
    const onClearFilters = vi.fn();
    renderView([], { filtered: true, onClearFilters });

    await userEvent.click(screen.getByRole('button', { name: 'overview.versions.clearFilters' }));

    expect(onClearFilters).toHaveBeenCalled();
  });
});

describe('choosing the axes', () => {
  it('offers the two intrinsic axes and the dimensions that have values', async () => {
    signedIn(true);
    renderView([reading({ attributes: { client: 'acme' } })], {
      dimensions: { client: ['acme'], unused: [] },
    });

    const rows = screen.getByLabelText('overview.matrix.rows');
    expect([...rows.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'repo',
      'environment',
      'client',
    ]);
  });

  it('hands the chosen axis back rather than crossing it itself', async () => {
    signedIn(true);
    const onAxesChange = vi.fn();
    renderView([reading({ attributes: { client: 'acme' } })], {
      dimensions: { client: ['acme'] },
      onAxesChange,
    });

    await userEvent.selectOptions(screen.getByLabelText('overview.matrix.rows'), 'client');

    expect(onAxesChange).toHaveBeenCalledWith({ rows: 'client' });
  });

  it('never offers the row axis as a column too', () => {
    signedIn(true);
    renderView([reading({ attributes: { client: 'acme' } })], {
      dimensions: { client: ['acme'] },
      axes: { rows: 'client', columns: 'environment' },
    });

    const columns = screen.getByLabelText('overview.matrix.columns');
    expect([...columns.querySelectorAll('option')].map((o) => o.value)).not.toContain('client');
  });

  it('offers no picker when there is nothing to lay out', () => {
    signedIn(true);
    renderView([]);

    expect(screen.queryByLabelText('overview.matrix.rows')).toBeNull();
  });
});

describe('what a cell says', () => {
  it('marks the environment behind the rest of its repo', () => {
    signedIn(true);
    renderView([
      reading({ environment: 'dev', version: '2.1.0', ref: 'v2.1.0' }),
      reading({ environment: 'prod', version: '2.0.8', ref: 'v2.0.8' }),
    ]);

    expect(screen.getAllByText('overview.versions.behind')).toHaveLength(1);
  });

  it('marks nothing when the repo cannot be ordered', () => {
    signedIn(true);
    renderView([
      reading({ environment: 'dev', version: 'nightly' }),
      reading({ environment: 'prod', version: '2.0.8' }),
    ]);

    expect(screen.queryByText('overview.versions.behind')).toBeNull();
  });

  // The property free axes rest on: the same reading is flagged whichever way
  // the grid is crossed, because the judgement was made before the layout.
  it('keeps the mark when the same data is crossed another way', () => {
    signedIn(true);
    renderView(
      [
        reading({ environment: 'dev', version: '2.1.0', attributes: { client: 'acme' } }),
        reading({ environment: 'prod', version: '2.0.8', attributes: { client: 'acme' } }),
      ],
      { dimensions: { client: ['acme'] }, axes: { rows: 'client', columns: 'environment' } },
    );

    expect(screen.getAllByText('overview.versions.behind')).toHaveLength(1);
  });

  it('shows a crossing nothing was read for as a dash', () => {
    signedIn(true);
    renderView([
      reading({ repo: 'acme/api', environment: 'prod' }),
      reading({ repo: 'acme/web', environment: 'dev' }),
    ]);

    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('reports a failed reading rather than leaving the cell blank', () => {
    signedIn(true);
    renderView([
      reading({ version: null, status: 'unreachable', error: { code: 'errors.version.timeout' } }),
    ]);

    expect(screen.getByText('versions.status.unreachable')).toBeInTheDocument();
    expect(screen.getByText('errors.version.timeout')).toBeInTheDocument();
  });

  it('shows the gap with the ref that was deployed here', () => {
    signedIn(true);
    renderView([reading({ version: '1.4.1', ref: 'v1.4.2' })]);

    // A different gap from "behind": this one is against the deployment that
    // was sent to this very environment.
    expect(screen.getByText(/≠ v1.4.2/)).toBeInTheDocument();
  });
});

describe('a cell holding several readings', () => {
  const crossed = { dimensions: { client: ['acme'] }, axes: { rows: 'client', columns: 'environment' } };

  it('shows the release when they agree, and says how many it stands for', () => {
    signedIn(true);
    renderView(
      [
        reading({ repo: 'acme/api', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', attributes: { client: 'acme' } }),
      ],
      crossed,
    );

    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    // The matrix's own idiom rather than a second one invented here.
    expect(screen.getByText(/overview.matrix.more/)).toBeInTheDocument();
  });

  it('refuses to name a version when they disagree', () => {
    signedIn(true);
    renderView(
      [
        reading({ repo: 'acme/api', version: '1.4.2', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', version: '2.0.0', attributes: { client: 'acme' } }),
      ],
      crossed,
    );

    expect(screen.getByText('overview.versions.mixed')).toBeInTheDocument();
    // Picking one of them would claim a set of environments runs a release it
    // does not agree on.
    expect(screen.queryByText('1.4.2')).toBeNull();
    expect(screen.queryByText('2.0.0')).toBeNull();
  });

  it('keeps the detail of a disagreement reachable', () => {
    signedIn(true);
    const { container } = renderView(
      [
        reading({ repo: 'acme/api', version: '1.4.2', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', version: '2.0.0', attributes: { client: 'acme' } }),
      ],
      crossed,
    );

    const cell = container.querySelector('.version-cell.mixed');
    expect(cell?.getAttribute('title')).toContain('acme/api · prod: 1.4.2');
    expect(cell?.getAttribute('title')).toContain('acme/web · prod: 2.0.0');
  });
});

describe('opening the timeline of a cell', () => {
  it('makes a cell that has a story a real button', async () => {
    signedIn(true);
    const onOpenHistory = vi.fn();
    renderView([reading()], { onOpenHistory });

    // A button, not a div with a click handler: it takes focus, answers the
    // keyboard and announces itself as an action.
    const cell = screen.getByRole('button', { name: /1.4.2/ });
    await userEvent.click(cell);

    expect(onOpenHistory).toHaveBeenCalledWith({ repo: 'acme/api', environment: 'prod' });
  });

  it('opens from the keyboard as well as the pointer', async () => {
    signedIn(true);
    const onOpenHistory = vi.fn();
    renderView([reading()], { onOpenHistory });

    const cell = screen.getByRole('button', { name: /1.4.2/ });
    cell.focus();
    // Focusable and activated by Enter, both of which come free with a button
    // and neither of which a div with an onClick has.
    expect(document.activeElement).toBe(cell);
    await userEvent.keyboard('{Enter}');

    expect(onOpenHistory).toHaveBeenCalled();
  });

  it('reads nothing until the cell is clicked', () => {
    signedIn(true);
    const onOpenHistory = vi.fn();
    renderView([reading()], { onOpenHistory });

    // Rendering the grid asks for no timeline: forty cells would otherwise be
    // forty requests nobody made.
    expect(onOpenHistory).not.toHaveBeenCalled();
  });

  it('does not open a cell that speaks for several environments', async () => {
    // Crossed on a dimension, one cell can hold four pairs. A timeline is the
    // story of one environment, and picking one of them would answer a
    // question nobody asked.
    signedIn(true);
    renderView(
      [
        reading({ repo: 'acme/api', attributes: { client: 'acme' } }),
        reading({ repo: 'acme/web', attributes: { client: 'acme' } }),
      ],
      { dimensions: { client: ['acme'] }, axes: { rows: 'client', columns: 'environment' } },
    );

    expect(screen.queryByRole('button', { name: /1.4.2/ })).toBeNull();
  });
});
