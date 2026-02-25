import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvRulePublic, SourcePublic } from '@repo/shared';
import { EnvRulesPage } from './EnvRulesPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    listEnvRules: vi.fn(),
    listSources: vi.fn(),
    sourceRepositories: vi.fn(),
    previewEnvRules: vi.fn(),
    classifyEnv: vi.fn(),
    deleteEnvRule: vi.fn(),
  },
}));

const { api } = await import('../api');

function rule(over: Partial<EnvRulePublic> = {}): EnvRulePublic {
  return {
    id: 'r-1',
    name: 'Billing',
    pattern: '^(?<Env>(Prod|Preprod))(?<Customer>[a-zA-Z-]+)$',
    kind: 'simple',
    target: 'environment',
    priority: 100,
    attributes: { App: 'Billing' },
    repo: 'billing$',
    createdAt: '2026-07-30T09:00:00.000Z',
    updatedAt: '2026-07-30T09:00:00.000Z',
    ...over,
  };
}

const CLASSIFIED = { name: 'PreprodGlobex', attributes: {}, metaEnvironments: [] };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings/environments']}>
      <EnvRulesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // The config clears nothing between tests, and half of what this suite
  // asserts is which of the two calls was *not* made.
  vi.clearAllMocks();
  vi.mocked(api.listEnvRules).mockResolvedValue({
    items: [rule()],
    page: { total: 1, limit: 25, offset: 0, hasMore: false },
  });
  vi.mocked(api.listSources).mockResolvedValue({
    items: [{ id: 'src-1', name: 'Acme GitLab' } as SourcePublic],
    page: { total: 1, limit: 25, offset: 0, hasMore: false },
  });
  vi.mocked(api.sourceRepositories).mockResolvedValue([
    { name: 'acme/globex-billing', visibility: 'private' },
    { name: 'acme/globex-portal', visibility: 'private' },
  ]);
  vi.mocked(api.previewEnvRules).mockResolvedValue(CLASSIFIED);
  vi.mocked(api.classifyEnv).mockResolvedValue(CLASSIFIED);
});

describe('the rule tester', () => {
  it('tries the listed rules when no source is named', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envRules.testRule' }));
    await user.type(screen.getByPlaceholderText(/placeholder/), 'PreprodGlobex');
    await user.click(screen.getByRole('button', { name: 'envRules.preview.classify' }));

    // Stateless: a rule can be tried before any source subscribes to it.
    expect(api.previewEnvRules).toHaveBeenCalled();
    expect(api.classifyEnv).not.toHaveBeenCalled();
  });

  it('asks the source itself once one is named', async () => {
    // The difference that matters: a rule written but never enabled on a
    // source passes the catalogue test and does nothing in production.
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envRules.testRule' }));
    await user.selectOptions(screen.getByRole('combobox'), 'src-1');
    await user.type(screen.getByPlaceholderText(/placeholder/), 'PreprodGlobex');
    await user.type(screen.getByLabelText('envRules.form.repo'), 'acme/globex-billing');
    await user.click(screen.getByRole('button', { name: 'envRules.preview.classify' }));

    expect(api.classifyEnv).toHaveBeenCalledWith(
      'src-1',
      'PreprodGlobex',
      'environment',
      'acme/globex-billing',
    );
    expect(api.previewEnvRules).not.toHaveBeenCalled();
  });

  it("offers the source's own repo names rather than what one believes them to be", async () => {
    // A GitLab repo carries its whole namespace; an anchored pattern written
    // against the bare name never matches, and only the real string shows it.
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'envRules.testRule' }));
    await user.selectOptions(screen.getByRole('combobox'), 'src-1');

    await waitFor(() =>
      expect(screen.getByLabelText('envRules.form.repo')).toHaveAttribute('list', 'preview-repos'),
    );
    const offered = [...document.querySelectorAll('#preview-repos option')].map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(offered).toEqual(['acme/globex-billing', 'acme/globex-portal']);
  });
});
