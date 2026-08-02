import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcePublic, VersionProbeOutcome } from '@repo/shared';
import { SourcesPage } from './SourcesPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    listSources: vi.fn(),
    listQuotas: vi.fn(),
    listBudgets: vi.fn(),
    listCoverage: vi.fn(),
    probeSourceVersions: vi.fn(),
  },
}));

const { api } = await import('../api');

function source(over: Partial<SourcePublic> = {}): SourcePublic {
  return {
    id: 'src-1',
    name: 'Acme GitLab',
    slug: 'acme-gitlab',
    kind: 'gitlab',
    baseUrl: 'https://gitlab.acme.test',
    authKind: 'token',
    scope: { owner: 'acme' },
    mode: 'stored',
    webhooksEnabled: false,
    historyDays: null,
    isDefault: true,
    envRuleIds: [],
    envUrlRuleIds: [],
    versionRuleIds: [],
    trackerIds: [],
    incidentTrackerId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function outcome(over: Partial<VersionProbeOutcome> = {}): VersionProbeOutcome {
  return { probed: 0, skipped: 0, failed: 0, changed: 0, rules: 0, environments: 0, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listSources).mockResolvedValue({
    items: [source()],
    page: { total: 1, limit: 25, offset: 0, hasMore: false },
  });
  vi.mocked(api.listQuotas).mockResolvedValue([]);
  vi.mocked(api.listBudgets).mockResolvedValue([]);
  vi.mocked(api.listCoverage).mockResolvedValue([]);
});

/** Renders the list and presses the version-reading action on its one source. */
async function probe(result: VersionProbeOutcome) {
  vi.mocked(api.probeSourceVersions).mockResolvedValue(result);
  const user = userEvent.setup();
  render(<SourcesPage onChange={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'sources.probe.action' }));
  return user;
}

describe('reading the installed versions by hand', () => {
  it('runs against the saved source', async () => {
    await probe(outcome({ probed: 2, rules: 1, environments: 2 }));

    expect(api.probeSourceVersions).toHaveBeenCalledWith('src-1');
  });

  it('says a source has no rule rather than reporting success', async () => {
    await probe(outcome());

    // Four zeroes and "done" would send somebody hunting a broken probe when
    // the answer is that nothing was ever attached.
    expect(await screen.findByText(/sources.probe.noRules/)).toBeInTheDocument();
  });

  it('says the rules found no environment to describe', async () => {
    await probe(outcome({ rules: 2 }));

    // The diagnosis nothing else gives: the rules are fine, and no deployment
    // has been collected for them to speak about.
    expect(await screen.findByText(/sources.probe.noEnvironments/)).toBeInTheDocument();
  });

  it('reports the figures when environments were read', async () => {
    await probe(outcome({ probed: 3, changed: 1, rules: 1, environments: 3 }));

    expect(await screen.findByText(/sources.probe.changed/)).toBeInTheDocument();
  });

  it('reports what answered nothing usable', async () => {
    await probe(outcome({ probed: 3, failed: 2, rules: 1, environments: 3 }));

    expect(await screen.findByText(/sources.probe.someFailed/)).toBeInTheDocument();
  });

  it('does not send a second round of requests on a double click', async () => {
    // These go to somebody's production application, not to a platform API.
    let release: (value: VersionProbeOutcome) => void = () => {};
    vi.mocked(api.probeSourceVersions).mockReturnValue(
      new Promise<VersionProbeOutcome>((resolve) => {
        release = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<SourcesPage onChange={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'sources.probe.action' });

    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);

    expect(api.probeSourceVersions).toHaveBeenCalledTimes(1);
    release(outcome({ probed: 1, rules: 1, environments: 1 }));
  });
});
