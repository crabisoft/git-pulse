import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClassifiedDeployment,
  DeploymentReport,
  DeploymentVersion,
  EnvironmentVersion,
} from '@repo/shared';
import { DeploymentsPage } from './DeploymentsPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { deployments: vi.fn() },
}));

const { api } = await import('../api');

function deployment(over: Partial<ClassifiedDeployment> = {}): ClassifiedDeployment {
  return {
    id: 'dep-1',
    repo: 'acme/portal',
    environment: 'prod',
    ref: 'v1.4.2',
    status: 'success',
    createdAt: '2026-08-01T09:00:00.000Z',
    environmentUrl: null,
    url: null,
    attributes: {},
    metaEnvironments: [],
    refUrl: 'https://example.com/tree/v1.4.2',
    ...over,
  };
}

/** A reading frozen against a deployment, as the API hands it over. */
function frozen(over: Partial<DeploymentVersion> = {}): DeploymentVersion {
  return {
    deploymentId: 'dep-1',
    repo: 'acme/portal',
    environment: 'prod',
    ref: 'v1.4.2',
    deployedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    version: '1.4.2',
    ruleId: 'vr-1',
    url: 'https://portal.example.com/actuator/info',
    status: 'ok',
    error: null,
    observedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    delaySec: 360,
    ...over,
  };
}

/** What an environment answers now, which is a weaker claim than a frozen row. */
function current(over: Partial<EnvironmentVersion> = {}): EnvironmentVersion {
  return {
    repo: 'acme/portal',
    environment: 'prod',
    version: '1.4.2',
    deploymentId: null,
    ref: null,
    ruleId: 'vr-1',
    url: null,
    status: 'ok',
    error: null,
    attributes: {},
    metaEnvironments: [],
    observedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    changedAt: null,
    ...over,
  };
}

function report(over: Partial<DeploymentReport> = {}): DeploymentReport {
  return {
    deployments: {
      items: [deployment()],
      page: { total: 1, limit: 25, offset: 0, hasMore: false },
    },
    repos: ['acme/portal'],
    environments: ['prod'],
    statuses: ['success'],
    dimensions: {},
    versions: [],
    currentVersions: [],
    // Rules attached is what shows the column; the fixtures that care say so.
    versionRules: 1,
    period: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T23:59:59.000Z', windowDays: 30 },
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/deployments/acme']}>
      <DeploymentsPage sourceId="src-1" slug="acme" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the version a deployment's environment was confirmed to run", () => {
  it('shows no column at all when the source has no version rule', async () => {
    vi.mocked(api.deployments).mockResolvedValue(report({ versionRules: 0 }));
    renderPage();

    // An install that never asked for versions is not an install whose probes
    // are failing, and a column of "not read" would say it was.
    expect(await screen.findByText('deployments.title')).toBeInTheDocument();
    expect(screen.queryByText('versions.running')).toBeNull();
  });

  it('shows the column on a configured source before anything has been read', async () => {
    // The regression this replaced: hiding the column exactly when somebody is
    // looking for it to find out why it is empty.
    vi.mocked(api.deployments).mockResolvedValue(report({ versionRules: 2 }));
    renderPage();

    expect(await screen.findByText('versions.running')).toBeInTheDocument();
    expect(screen.getByText('versions.neverRead')).toBeInTheDocument();
  });

  it('shows the version frozen against that very deployment', async () => {
    vi.mocked(api.deployments).mockResolvedValue(report({ versions: [frozen()] }));
    renderPage();

    expect(await screen.findByText('versions.running')).toBeInTheDocument();
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    // Agreement is the ordinary case and says so by saying nothing.
    expect(screen.queryByText('versions.differs')).toBeNull();
  });

  it('flags the gap the feature exists for', async () => {
    vi.mocked(api.deployments).mockResolvedValue(
      report({ versions: [frozen({ version: '1.4.1' })] }),
    );
    renderPage();

    // Deployed v1.4.2, answered 1.4.1: the deployment did not take.
    expect(await screen.findByText('versions.differs')).toBeInTheDocument();
  });

  it('says nothing about a ref that states no release', async () => {
    vi.mocked(api.deployments).mockResolvedValue(
      report({
        deployments: {
          items: [deployment({ ref: 'main' })],
          page: { total: 1, limit: 25, offset: 0, hasMore: false },
        },
        versions: [frozen()],
      }),
    );
    renderPage();

    expect(await screen.findByText('1.4.2')).toBeInTheDocument();
    // An environment answering perfectly well must not be flagged because a
    // branch was deployed to it.
    expect(screen.queryByText('versions.differs')).toBeNull();
  });

  it('reports a frozen reading that failed rather than leaving the cell empty', async () => {
    vi.mocked(api.deployments).mockResolvedValue(
      report({
        versions: [
          frozen({ version: null, status: 'unreachable', error: { code: 'errors.version.timeout' } }),
        ],
      }),
    );
    renderPage();

    // "We asked and got nothing" is actionable in a way a blank is not.
    expect(await screen.findByText(/versions.status.unreachable/)).toBeInTheDocument();
  });

  it('says a deployment was never read, rather than showing a blank', async () => {
    // The row that has a column but no frozen record: something else was read,
    // this one was replaced before a probe reached it. It never will be — so
    // the cell says so instead of leaving a gap that looks fillable.
    vi.mocked(api.deployments).mockResolvedValue(
      report({
        deployments: {
          items: [deployment(), deployment({ id: 'dep-2', ref: 'v1.4.1' })],
          page: { total: 2, limit: 25, offset: 0, hasMore: false },
        },
        versions: [frozen()],
      }),
    );
    renderPage();

    expect(await screen.findByText('versions.neverRead')).toBeInTheDocument();
    expect(screen.getAllByText('versions.neverRead')).toHaveLength(1);
  });

  it('states how long after the deployment the reading was taken', async () => {
    // Three seconds in is much weaker evidence than ten minutes in, and only
    // the reader can weigh that.
    vi.mocked(api.deployments).mockResolvedValue(
      report({ versions: [frozen({ delaySec: 3 })] }),
    );
    renderPage();

    expect(await screen.findByTitle(/versions.readAfter/)).toBeInTheDocument();
  });

  it('falls back to the current version on the deployment still standing', async () => {
    // Everything deployed before the rules existed has no frozen row and never
    // will. Without this the column is blank for ever on all of the history.
    vi.mocked(api.deployments).mockResolvedValue(
      report({ versions: [], currentVersions: [current()] }),
    );
    renderPage();

    expect(await screen.findByText('1.4.2')).toBeInTheDocument();
    // Marked as what the environment answers, never as what this deployment is
    // known to have delivered: the two are different claims.
    expect(screen.getByText('versions.current')).toBeInTheDocument();
  });

  it('never offers the current version on a superseded deployment', async () => {
    vi.mocked(api.deployments).mockResolvedValue(
      report({
        deployments: {
          items: [
            deployment({ id: 'dep-2', createdAt: '2026-08-01T10:00:00.000Z' }),
            deployment({ id: 'dep-1', createdAt: '2026-07-30T09:00:00.000Z' }),
          ],
          page: { total: 2, limit: 25, offset: 0, hasMore: false },
        },
        versions: [],
        currentVersions: [current()],
      }),
    );
    renderPage();

    // The older row gets "not read", because what the environment runs today
    // is the newer deployment's doing.
    expect(await screen.findByText('versions.current')).toBeInTheDocument();
    expect(screen.getAllByText('versions.current')).toHaveLength(1);
    expect(screen.getAllByText('versions.neverRead')).toHaveLength(1);
  });

  it('never lets the current version stand in for a frozen one', async () => {
    // A frozen reading was taken against this very deployment; the current
    // state is the weaker claim and must not replace it.
    vi.mocked(api.deployments).mockResolvedValue(
      report({
        versions: [frozen({ version: '1.4.2' })],
        currentVersions: [current({ version: '9.9.9' })],
      }),
    );
    renderPage();

    expect(await screen.findByText('1.4.2')).toBeInTheDocument();
    expect(screen.queryByText('9.9.9')).toBeNull();
    expect(screen.queryByText('versions.current')).toBeNull();
  });
});
