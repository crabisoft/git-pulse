import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketRulePublic, TrackerPublic } from '@repo/shared';
import { TicketRulesPage } from './TicketRulesPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    listTicketRules: vi.fn(),
    listTrackers: vi.fn(),
    createTicketRule: vi.fn(),
    updateTicketRule: vi.fn(),
    deleteTicketRule: vi.fn(),
    previewTicketRules: vi.fn(),
  },
}));

const { api } = await import('../api');

const PAGE = { total: 1, limit: 25, offset: 0, hasMore: false };

function rule(over: Partial<TicketRulePublic> = {}): TicketRulePublic {
  return {
    id: 'tr-1',
    trackerId: 'trk-1',
    name: 'Jira keys',
    pattern: '(?<key>[A-Z]{2,5}-\\d+)',
    sources: ['branch', 'commit'],
    priority: 100,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

const TRACKERS = [{ id: 'trk-1', name: 'Jira', kind: 'jira' }] as TrackerPublic[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listTicketRules).mockResolvedValue({
    items: [rule()],
    page: PAGE,
  });
  vi.mocked(api.listTrackers).mockResolvedValue({
    items: TRACKERS,
    page: PAGE,
  });
  vi.mocked(api.updateTicketRule).mockResolvedValue(rule());
});

/** Opens the edit form of the one listed rule. */
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'common.edit' }));
}

describe('the texts a rule reads', () => {
  it('shows what each rule is confined to, which decides where its links come from', async () => {
    render(<TicketRulesPage />);

    expect(
      await screen.findByText('ticketRules.source.branch, ticketRules.source.commit'),
    ).toBeInTheDocument();
  });

  it('saves the set as it was ticked', async () => {
    const user = userEvent.setup();
    render(<TicketRulesPage />);
    await edit(user);
    await user.click(screen.getByRole('checkbox', { name: /ticketRules\.source\.body/ }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(api.updateTicketRule).toHaveBeenCalled());
    const [, input] = vi.mocked(api.updateTicketRule).mock.calls[0];
    // Reading order, not ticking order: it is the order the extraction
    // attributes a key found in several texts at once.
    expect(input.sources).toEqual(['branch', 'body', 'commit']);
  });

  it('refuses a rule that would read nothing rather than saving one that matches nothing', async () => {
    const user = userEvent.setup();
    render(<TicketRulesPage />);
    await edit(user);
    await user.click(screen.getByRole('checkbox', { name: /ticketRules\.source\.branch/ }));
    await user.click(screen.getByRole('checkbox', { name: /ticketRules\.source\.commit/ }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText('errors.ticketRule.noSource')).toBeInTheDocument();
    expect(api.updateTicketRule).not.toHaveBeenCalled();
  });

  it('tests a sample of every text, since a rule may be confined to any of them', async () => {
    vi.mocked(api.previewTicketRules).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<TicketRulesPage />);

    await user.click(await screen.findByRole('button', { name: 'ticketRules.testAll' }));
    await user.type(screen.getByLabelText('ticketRules.preview.body'), 'Closes OPS-7');
    await user.type(screen.getByLabelText('ticketRules.preview.commit'), 'fix: login');
    await user.click(screen.getByRole('button', { name: 'ticketRules.preview.run' }));

    await waitFor(() => expect(api.previewTicketRules).toHaveBeenCalled());
    expect(vi.mocked(api.previewTicketRules).mock.calls[0][0]).toMatchObject({
      body: 'Closes OPS-7',
      commit: 'fix: login',
    });
  });
});
