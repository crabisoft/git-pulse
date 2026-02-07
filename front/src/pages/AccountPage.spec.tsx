import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserPublic } from '@repo/shared';
import { AccountPage } from './AccountPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { updateMe: vi.fn() },
}));

const refresh = vi.fn();
vi.mock('../auth', () => ({ useAuth: () => ({ refresh }) }));

const { api } = await import('../api');

const USER: UserPublic = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  display: { direction: null, mode: null },
  language: null,
};

function renderPage(user: UserPublic = USER) {
  render(<AccountPage user={user} />);
  return {
    save: screen.getByRole('button', { name: 'common.save' }),
    name: screen.getByLabelText(/account\.name/),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.updateMe).mockResolvedValue({
    user: USER,
    publicDashboard: true,
    setupRequired: false,
  });
});

describe('AccountPage', () => {
  it('has nothing to save until something is edited', () => {
    const { save } = renderPage();
    expect(save).toBeDisabled();
  });

  it('sends every section in one request', async () => {
    const { save, name } = renderPage();
    await userEvent.clear(name);
    await userEvent.type(name, 'Ada King');
    await userEvent.selectOptions(screen.getByLabelText('account.displayDirection'), 'stream');
    await userEvent.click(save);

    // One request for all of it, so a rejected field cannot leave a renamed
    // account and a changed preference behind it.
    await waitFor(() => expect(api.updateMe).toHaveBeenCalledOnce());
    expect(api.updateMe).toHaveBeenCalledWith({
      name: 'Ada King',
      displayDirection: 'stream',
    });
  });

  it('keeps the default mode here, whatever the bar switches', async () => {
    // The bar at the top changes the mode for the moment somebody is in; this
    // is where the account says which one it starts in. One field, two ways to
    // reach it — so this one still has to write.
    const { save } = renderPage();
    await userEvent.selectOptions(screen.getByLabelText(/account\.displayMode/), 'dark');
    await userEvent.click(save);

    await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith({ displayMode: 'dark' }));
  });

  it('leaves out what was not touched', async () => {
    const { save } = renderPage();
    await userEvent.selectOptions(screen.getByLabelText('account.displayDirection'), 'stream');
    await userEvent.click(save);

    // Sending the name unchanged would ask the server to rename the account to
    // what it is already called.
    await waitFor(() =>
      expect(api.updateMe).toHaveBeenCalledWith({ displayDirection: 'stream' }),
    );
  });

  it('hands a preference back to the installation default', async () => {
    // Empty is a value, not an omission: it is the only way to stop overriding
    // the default once one has.
    const chosen = { ...USER, display: { direction: 'stream' as const, mode: null } };
    const { save } = renderPage(chosen);
    await userEvent.selectOptions(screen.getByLabelText('account.displayDirection'), '');
    await userEvent.click(save);

    await waitFor(() => expect(api.updateMe).toHaveBeenCalledWith({ displayDirection: null }));
  });

  it('refuses a password that was not confirmed, without asking the server', async () => {
    const { save } = renderPage();
    await userEvent.type(screen.getByLabelText(/account\.currentPassword/), 'old-secret');
    await userEvent.type(screen.getByLabelText(/account\.newPassword/), 'new-secret-1');
    await userEvent.type(screen.getByLabelText('auth.confirmPassword'), 'new-secret-2');
    await userEvent.click(save);

    expect(api.updateMe).not.toHaveBeenCalled();
    expect(screen.getByText('auth.passwordMismatch')).toBeInTheDocument();
  });

  it('sends the current password along with the new one', async () => {
    const { save } = renderPage();
    await userEvent.type(screen.getByLabelText(/account\.currentPassword/), 'old-secret');
    await userEvent.type(screen.getByLabelText(/account\.newPassword/), 'new-secret');
    await userEvent.type(screen.getByLabelText('auth.confirmPassword'), 'new-secret');
    await userEvent.click(save);

    await waitFor(() =>
      expect(api.updateMe).toHaveBeenCalledWith({
        password: 'new-secret',
        currentPassword: 'old-secret',
      }),
    );
  });

  it('clears the password fields once they are accepted, and says so', async () => {
    const { save } = renderPage();
    await userEvent.type(screen.getByLabelText(/account\.currentPassword/), 'old-secret');
    await userEvent.type(screen.getByLabelText(/account\.newPassword/), 'new-secret');
    await userEvent.type(screen.getByLabelText('auth.confirmPassword'), 'new-secret');
    await userEvent.click(save);

    await waitFor(() => expect(screen.getByText('account.saved')).toBeInTheDocument());
    expect(screen.getByLabelText(/account\.newPassword/)).toHaveValue('');
    // The corner reads the name from the session state, and the application
    // reads the presentation from it.
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps what was typed when the server refuses it', async () => {
    vi.mocked(api.updateMe).mockRejectedValue(new Error('nope'));
    const { save, name } = renderPage();
    await userEvent.clear(name);
    await userEvent.type(name, 'Ada King');
    await userEvent.click(save);

    await waitFor(() => expect(screen.getByRole('button', { name: 'common.save' })).toBeEnabled());
    expect(screen.getByLabelText(/account\.name/)).toHaveValue('Ada King');
  });

  it('will not let an admin promote themselves from here', () => {
    // The role and the address are how an admin identifies an account: letting
    // it rewrite either would let it rename itself out from under whoever
    // granted it.
    renderPage({ ...USER, role: 'admin' });
    expect(screen.getByLabelText(/account\.role/)).toBeDisabled();
    expect(screen.getByLabelText(/account\.email/)).toBeDisabled();
  });
});
