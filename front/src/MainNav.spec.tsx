import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MainNav } from './MainNav';

function nav(module = 'dashboard', slug: string | null = 'acme') {
  render(
    <MemoryRouter>
      <MainNav module={module} withSource={(base) => (slug ? `${base}/${slug}` : base)} />
    </MemoryRouter>,
  );
  return { burger: screen.getByRole('button', { name: 'nav.menu' }) };
}

describe('MainNav', () => {
  it('renders every section once, whatever the width', () => {
    // One nav element in the document rather than a strip and a drawer holding
    // copies of each other: the stylesheet folds this one, so a screen reader
    // and a search of the DOM both find exactly one of each section.
    nav();
    for (const label of [
      'nav.overview',
      'nav.dora',
      'nav.deployments',
      'nav.changelogs',
      'nav.releaseNotes',
    ]) {
      expect(screen.getAllByRole('link', { name: label })).toHaveLength(1);
    }
  });

  it('carries the active source into every section', () => {
    // Switching section keeps you on the source you were reading.
    nav();
    expect(screen.getByRole('link', { name: 'nav.dora' })).toHaveAttribute('href', '/dora/acme');
  });

  it('links to the section itself when there is no source yet', () => {
    nav('dashboard', null);
    expect(screen.getByRole('link', { name: 'nav.dora' })).toHaveAttribute('href', '/dora');
  });

  it('says which section is being read, and not only in colour', () => {
    nav('deployments');
    expect(screen.getByRole('link', { name: 'nav.deployments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'nav.dora' })).not.toHaveAttribute('aria-current');
  });

  it('opens and closes the drawer', async () => {
    const { burger } = nav();
    expect(burger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(burger);
    expect(burger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(burger);
    expect(burger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the page behind it is touched', async () => {
    const { burger } = nav();
    await userEvent.click(burger);
    await userEvent.click(document.body);

    expect(burger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and hands the focus back', async () => {
    const { burger } = nav();
    await userEvent.click(burger);
    await userEvent.keyboard('{Escape}');

    expect(burger).toHaveAttribute('aria-expanded', 'false');
    expect(burger).toHaveFocus();
  });
});
