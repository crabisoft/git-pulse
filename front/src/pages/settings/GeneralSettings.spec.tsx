import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@repo/shared';
import { GeneralSettings } from './GeneralSettings';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { updateSettings: vi.fn() },
}));

const { api } = await import('../../api');

const SETTINGS: AppSettings = {
  doraWindowDays: 30,
  stalePrHours: 72,
  collectCron: '*/15 * * * *',
  pruneCron: '0 3 * * *',
  retentionMarginDays: 7,
  pageSize: 25,
  publicDashboard: true,
  failureSource: 'pipelines',
  incidentLabels: [],
  quotaReservePct: 10,
  componentAttribute: null,
  collectionPageCap: 20,
  releaseNotesGenerator: 'builtin',
  overviewDirection: 'control',
  displayMode: 'system',
};

const onChange = vi.fn();

function renderPage(settings: AppSettings = SETTINGS) {
  render(<GeneralSettings settings={settings} onChange={onChange} />);
  return { save: screen.getByRole('button', { name: 'common.save' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.updateSettings).mockResolvedValue(SETTINGS);
});

describe('GeneralSettings', () => {
  it('saves every block in one request', async () => {
    const { save } = renderPage();
    await userEvent.clear(screen.getByLabelText(/settings\.general\.stalePrHours/));
    await userEvent.type(screen.getByLabelText(/settings\.general\.stalePrHours/), '48');
    await userEvent.clear(screen.getByLabelText(/settings\.general\.retentionMargin/));
    await userEvent.type(screen.getByLabelText(/settings\.general\.retentionMargin/), '30');
    await userEvent.click(save);

    // The blocks sit side by side but are one page, one table and one round
    // trip — splitting them into forms of their own would ask for the same
    // save several times.
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledOnce());
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ stalePrHours: 48, retentionMarginDays: 30 }),
    );
  });

  it('holds the presentation defaults behind the same button', async () => {
    // They used to be written the moment they were picked. One page, one save.
    const { save } = renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/settings\.general\.displayMode/), 'dark');

    expect(api.updateSettings).not.toHaveBeenCalled();

    await userEvent.click(save);
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ displayMode: 'dark' }),
      ),
    );
  });

  it('says nothing about the language, which belongs to an account', async () => {
    // It followed the browser and was offered here; it is a preference the
    // account carries now, so this page must not claim to set it.
    renderPage();
    expect(screen.queryByLabelText(/language/i)).not.toBeInTheDocument();
  });

  it('asks for incident labels only once incidents are used', async () => {
    renderPage();
    expect(
      screen.queryByLabelText(/settings\.general\.incidentLabels/),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText(/settings\.general\.failureSource/),
      'incidents',
    );

    // Without it, every issue in the scope would count as a production failure.
    expect(screen.getByLabelText(/settings\.general\.incidentLabels/)).toBeInTheDocument();
  });

  it('reports a refusal without losing what was typed', async () => {
    vi.mocked(api.updateSettings).mockRejectedValue(new Error('nope'));
    const { save } = renderPage();
    await userEvent.clear(screen.getByLabelText(/settings\.general\.pruneCron/));
    await userEvent.type(screen.getByLabelText(/settings\.general\.pruneCron/), '0 4 * * *');
    await userEvent.click(save);

    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByLabelText(/settings\.general\.pruneCron/)).toHaveValue('0 4 * * *');
  });
});
