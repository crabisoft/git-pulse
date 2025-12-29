import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReleaseNoteEntry } from '@repo/shared';
import { CommitList } from './CommitList';

const BODY = 'Le cache tenait la réponse au-delà de la fenêtre.\n\nRefs: OPS-12';
const MESSAGE = `fix(api): purge le cache au bon moment\n\n${BODY}`;

function entry(over: Partial<ReleaseNoteEntry> = {}): ReleaseNoteEntry {
  return {
    summary: 'purge le cache au bon moment',
    message: MESSAGE,
    scope: 'api',
    breaking: false,
    sha: 'abc1234def',
    author: 'jdoe',
    url: 'https://github.com/acme/api/commit/abc1234def',
    tickets: [],
    pullRequest: null,
    ...over,
  };
}

describe('CommitList', () => {
  it('shows the summary and hides the body until it is asked for', () => {
    render(<CommitList entries={[entry()]} />);
    expect(screen.getByText('purge le cache au bon moment')).toBeInTheDocument();
    // Not merely hidden: a folded body is not in the document at all, so a
    // search of the page cannot land on text nobody can see.
    expect(screen.queryByText(/Le cache tenait la réponse/)).not.toBeInTheDocument();
  });

  it('unfolds the body, and folds it back', async () => {
    const user = userEvent.setup();
    render(<CommitList entries={[entry()]} />);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByText(/Le cache tenait la réponse/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(screen.queryByText(/Le cache tenait la réponse/)).not.toBeInTheDocument();
  });

  it('carries the whole message as the summary tooltip', () => {
    render(<CommitList entries={[entry()]} />);
    expect(screen.getByText('purge le cache au bon moment')).toHaveAttribute('title', MESSAGE);
  });

  it('offers nothing to unfold on a commit that is a subject and nothing else', () => {
    render(<CommitList entries={[entry({ message: 'fix(api): purge le cache au bon moment' })]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('unfolds one commit without unfolding its neighbours', async () => {
    const user = userEvent.setup();
    render(<CommitList entries={[entry(), entry({ sha: 'def5678abc' })]} />);

    await user.click(screen.getAllByRole('button')[0]);
    expect(screen.getAllByText(/Le cache tenait la réponse/)).toHaveLength(1);
  });

  it('links the request the commit came in on', () => {
    render(
      <CommitList
        entries={[
          entry({ pullRequest: { number: 42, url: 'https://github.com/acme/api/pull/42' } }),
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: '#42' })).toHaveAttribute(
      'href',
      'https://github.com/acme/api/pull/42',
    );
  });

  it('shows no request on a commit pushed straight to a branch', () => {
    render(<CommitList entries={[entry()]} />);
    expect(screen.queryByRole('link', { name: /^#/ })).not.toBeInTheDocument();
  });
});
