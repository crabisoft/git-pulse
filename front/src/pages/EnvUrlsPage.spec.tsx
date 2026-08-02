import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvUrlRulePublic, ManualEnvironmentPublic, SourcePublic } from '@repo/shared';
import type { EnvUrlPreview } from '../api';
import { EnvUrlsPage } from './EnvUrlsPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    listEnvUrlRules: vi.fn(),
    sourceRepositories: vi.fn(),
    createEnvUrlRule: vi.fn(),
    updateEnvUrlRule: vi.fn(),
    deleteEnvUrlRule: vi.fn(),
    previewEnvUrl: vi.fn(),
    listManualEnvironments: vi.fn(),
    createManualEnvironment: vi.fn(),
    updateManualEnvironment: vi.fn(),
    deleteManualEnvironment: vi.fn(),
  },
}));

const { api } = await import('../api');

function rule(over: Partial<EnvUrlRulePublic> = {}): EnvUrlRulePublic {
  return {
    id: 'eu-1',
    name: 'Client host',
    pattern: '^(?<client>[a-z]+)-prod$',
    repo: null,
    urlTemplate: 'https://{client}.example.com',
    mode: 'fill',
    priority: 100,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

function declared(over: Partial<ManualEnvironmentPublic> = {}): ManualEnvironmentPublic {
  return {
    id: 'me-1',
    sourceId: 'src-1',
    repo: '',
    environment: 'contoso-onsite',
    url: 'https://contoso.example.com',
    attributes: { client: 'contoso' },
    mode: 'fill',
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

const SOURCES = [
  { id: 'src-1', name: 'Acme GitLab' },
  { id: 'src-2', name: 'Globex GitHub' },
] as SourcePublic[];

const PAGE = { total: 1, limit: 25, offset: 0, hasMore: false };

function preview(over: Partial<EnvUrlPreview> = {}): EnvUrlPreview {
  return {
    url: 'https://contoso.example.com',
    published: null,
    rule: 'Client host',
    declared: false,
    unresolved: null,
    ...over,
  };
}

function renderPage(sources: SourcePublic[] = SOURCES) {
  return render(<EnvUrlsPage sources={sources} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listEnvUrlRules).mockResolvedValue({ items: [rule()], page: PAGE });
  vi.mocked(api.listManualEnvironments).mockResolvedValue({ items: [declared()], page: PAGE });
  vi.mocked(api.previewEnvUrl).mockResolvedValue(preview());
  vi.mocked(api.createManualEnvironment).mockResolvedValue(declared());
  vi.mocked(api.sourceRepositories).mockResolvedValue([
    { name: 'acme/extranet-back', visibility: 'private' },
    { name: 'acme/extranet-front', visibility: 'private' },
  ]);
});

/** Opens the tester and fills the one field it insists on. */
async function tryRules(user: ReturnType<typeof userEvent.setup>, opener: string) {
  await user.click(await screen.findByRole('button', { name: opener }));
  await user.type(screen.getByLabelText('envUrls.rules.test.environment'), 'contoso-prod');
}

describe('trying the rules', () => {
  it('tries the one rule a row asks about', async () => {
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testRule');
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    // The row's tester answers for that rule alone: the whole reason to open it
    // from a row rather than from the panel is to see what *it* does.
    const [input] = vi.mocked(api.previewEnvUrl).mock.calls[0];
    expect(input.rules.map((r) => r.name)).toEqual(['Client host']);
  });

  it('tries the whole listed set from the panel', async () => {
    vi.mocked(api.listEnvUrlRules).mockResolvedValue({
      items: [rule(), rule({ id: 'eu-2', name: 'Regional host', priority: 50 })],
      page: { ...PAGE, total: 2 },
    });
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testAll');
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    // Which is the question the panel asks: an address is decided by the set,
    // since only one rule of it wins.
    const [input] = vi.mocked(api.previewEnvUrl).mock.calls[0];
    expect(input.rules.map((r) => r.name)).toEqual(['Client host', 'Regional host']);
  });

  it('sends the published address, which decides the answer as much as a rule does', async () => {
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testAll');
    await user.type(
      screen.getByLabelText(/envUrls\.rules\.test\.published/),
      'https://published.example.com',
    );
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    // A rule that fills is silent whenever the platform said something, and
    // that silence is exactly what an author has no other way of seeing.
    const [input] = vi.mocked(api.previewEnvUrl).mock.calls[0];
    expect(input.environmentUrl).toBe('https://published.example.com');
  });

  it('leaves the published address out when the field is empty, rather than sending none', async () => {
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testAll');
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    // An empty string is an address the platform published and nobody can
    // reach; the usual case is that it published nothing at all.
    const [input] = vi.mocked(api.previewEnvUrl).mock.calls[0];
    expect(input.environmentUrl).toBeUndefined();
    expect(input.repo).toBeUndefined();
  });

  it('says when nothing addresses the environment, rather than showing an empty result', async () => {
    vi.mocked(api.previewEnvUrl).mockResolvedValue(preview({ url: null, rule: null }));
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testAll');
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    expect(await screen.findByText('envUrls.rules.test.none')).toBeInTheDocument();
  });

  it('names the rule and the placeholder when a template read nothing', async () => {
    // The two failures produce the same absent address and want opposite
    // fixes. Reported as "no rule addresses this environment", this one sends
    // the author back to a pattern that matched perfectly well.
    vi.mocked(api.previewEnvUrl).mockResolvedValue(
      preview({ url: null, rule: 'Extranet preprod', unresolved: 'customer' }),
    );
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testAll');
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    // The stub renders a key with its params, so both travel — and the
    // placeholder is shown braced, as it is written in the template.
    const note = await screen.findByText(/envUrls\.rules\.test\.unresolved/);
    expect(note).toHaveTextContent('Extranet preprod');
    expect(note).toHaveTextContent('{customer}');
    expect(screen.queryByText('envUrls.rules.test.none')).not.toBeInTheDocument();
  });

  it('names the rule that won when the set is tried', async () => {
    const user = userEvent.setup();
    renderPage();
    await tryRules(user, 'envUrls.rules.testAll');
    await user.click(screen.getByRole('button', { name: 'envUrls.rules.test.run' }));

    expect(await screen.findByText(/envUrls\.rules\.test\.via/)).toHaveTextContent('Client host');
  });
});

describe('testing a rule confined to a repo', () => {
  const confined = () => rule({ repo: 'extranet', pattern: 'Preprod(?<Customer>[a-zA-Z-]+)Back' });

  it('says the confined rules are left out while no repo is named', async () => {
    // Without it the dialog answered "no rule addresses this environment",
    // which sends the author back to a pattern that was never the problem.
    vi.mocked(api.listEnvUrlRules).mockResolvedValue({ items: [confined()], page: PAGE });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envUrls.rules.testAll' }));

    expect(screen.getByText('envUrls.rules.test.noRepoHint')).toBeInTheDocument();
  });

  it('stops saying it once one is named', async () => {
    vi.mocked(api.listEnvUrlRules).mockResolvedValue({ items: [confined()], page: PAGE });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envUrls.rules.testAll' }));
    await user.type(screen.getByLabelText(/envUrls\.rules\.test\.repo/), 'acme/extranet-back');

    expect(screen.queryByText('envUrls.rules.test.noRepoHint')).not.toBeInTheDocument();
  });

  it("offers the source's own repo names rather than what one believes them to be", async () => {
    // A GitLab repo carries its whole namespace, and a pattern written against
    // the bare name never matches.
    vi.mocked(api.listEnvUrlRules).mockResolvedValue({ items: [confined()], page: PAGE });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envUrls.rules.testAll' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/envUrls\.rules\.test\.repo/)).toHaveAttribute(
        'list',
        'env-url-test-repos',
      ),
    );
    const offered = [...document.querySelectorAll('#env-url-test-repos option')].map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(offered).toEqual(['acme/extranet-back', 'acme/extranet-front']);
  });

  it('asks neither question when no rule under test is confined', async () => {
    // The listed rule binds to no repo: naming one would change nothing, and
    // the field would be a question about nothing.
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envUrls.rules.testAll' }));

    expect(screen.queryByLabelText(/envUrls\.rules\.test\.repo/)).not.toBeInTheDocument();
    expect(api.sourceRepositories).not.toHaveBeenCalled();
  });
});

describe('declaring an environment', () => {
  // The two panels share this page and their row actions are worded alike.
  // Emptying the catalogue leaves the declared rows as the only ones, which is
  // what these tests are about.
  beforeEach(() => {
    vi.mocked(api.listEnvUrlRules).mockResolvedValue({
      items: [],
      page: { ...PAGE, total: 0 },
    });
  });

  it('reads and writes against the source in view', async () => {
    const user = userEvent.setup();
    renderPage();
    // The first source until somebody picks another, so a one-source install
    // never opens on a chooser showing nothing.
    expect(api.listManualEnvironments).toHaveBeenCalledWith('src-1', {});

    await user.selectOptions(screen.getByRole('combobox'), 'src-2');
    await user.click(screen.getByRole('button', { name: /envUrls\.declared\.addTitle/ }));
    await user.type(screen.getByLabelText('envUrls.declared.form.environment'), 'globex-onsite');
    await user.click(screen.getByRole('button', { name: 'envUrls.declared.form.submit' }));

    expect(api.createManualEnvironment).toHaveBeenCalledWith(
      'src-2',
      expect.objectContaining({ environment: 'globex-onsite' }),
    );
  });

  it('sends the attributes in full, so clearing a row clears what was stored', async () => {
    const user = userEvent.setup();
    renderPage([SOURCES[0]]);
    await user.click(await screen.findByRole('button', { name: 'common.edit' }));
    await user.click(screen.getByRole('button', { name: /envUrls\.declared\.form\.addAttribute/ }));

    const keys = screen.getAllByPlaceholderText('envUrls.declared.form.attrKey');
    await user.type(keys[1], 'tier');
    await user.type(screen.getAllByPlaceholderText('envUrls.declared.form.attrValue')[1], 'onsite');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    const [, payload] = vi.mocked(api.updateManualEnvironment).mock.calls[0];
    expect(payload.attributes).toEqual({ client: 'contoso', tier: 'onsite' });
  });

  it('drops a half-typed attribute rather than storing a key with no value', async () => {
    const user = userEvent.setup();
    renderPage([SOURCES[0]]);
    await user.click(await screen.findByRole('button', { name: 'common.edit' }));
    await user.click(screen.getByRole('button', { name: /envUrls\.declared\.form\.addAttribute/ }));
    await user.type(screen.getAllByPlaceholderText('envUrls.declared.form.attrKey')[1], 'tier');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    const [, payload] = vi.mocked(api.updateManualEnvironment).mock.calls[0];
    expect(payload.attributes).toEqual({ client: 'contoso' });
  });
});
