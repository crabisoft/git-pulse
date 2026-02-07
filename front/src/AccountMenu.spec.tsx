import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { UserPublic } from '@repo/shared';
import { AccountMenu } from './AccountMenu';

const USER: UserPublic = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'admin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  display: { direction: null, mode: null },
  language: null,
};

function menu(over: Partial<{ isAdmin: boolean; onSignOut: () => void }> = {}) {
  const onSignOut = over.onSignOut ?? vi.fn();
  render(
    <MemoryRouter>
      <AccountMenu user={USER} isAdmin={over.isAdmin ?? true} onSignOut={onSignOut} />
    </MemoryRouter>,
  );
  return { button: screen.getByRole('button', { name: USER.name }), onSignOut };
}

describe('AccountMenu', () => {
  it('shows the initials, and the name to whoever is not looking at them', () => {
    // The monogram is a shorthand for the name; a screen reader has no use for
    // the shorthand, so the button is labelled with the name itself.
    const { button } = menu();
    expect(button).toHaveTextContent('AL');
  });

  it('opens on click and offers the account, the settings and the way out', async () => {
    const { button } = menu();
    await userEvent.click(button);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'auth.account' })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(screen.getByRole('menuitem', { name: 'nav.settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('menuitem', { name: 'auth.signOut' })).toBeInTheDocument();
  });

  it('says nothing about the settings to an account that cannot reach them', async () => {
    // Hidden rather than disabled: to a visitor, the section does not exist.
    const { button } = menu({ isAdmin: false });
    await userEvent.click(button);

    expect(screen.queryByRole('menuitem', { name: 'nav.settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'auth.account' })).toBeInTheDocument();
  });

  it('closes on a second click', async () => {
    const { button } = menu();
    await userEvent.click(button);
    await userEvent.click(button);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when something else is clicked', async () => {
    const { button } = menu();
    await userEvent.click(button);
    await userEvent.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and hands the focus back', async () => {
    // A menu dismissed by the keyboard must not leave the keyboard at the top
    // of the document.
    const { button } = menu();
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('signs out and closes, in that order', async () => {
    const onSignOut = vi.fn();
    const { button } = menu({ onSignOut });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'auth.signOut' }));

    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('states whether it is open, for whoever cannot see it', async () => {
    const { button } = menu();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
