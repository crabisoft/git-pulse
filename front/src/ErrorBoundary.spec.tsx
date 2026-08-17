import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

/** A child that throws on render, as a page carrying a bad value does. */
function Boom({ message = 'nope' }: { message?: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  // React reports a caught error to the console itself. Silenced so a suite
  // that is *about* crashing does not read as a suite that crashed.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>the page</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('shows a message in place of a page that threw, rather than nothing', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('crash.title')).toBeInTheDocument();
    expect(screen.getByText('crash.reload')).toBeInTheDocument();
  });

  it('leaves what is outside it standing', () => {
    // The whole point of sitting inside the shell: navigating away is the
    // reader's way out, and it has to still be there.
    render(
      <>
        <nav>the navigation</nav>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </>,
    );

    expect(screen.getByText('the navigation')).toBeInTheDocument();
  });

  it('carries the error text, folded away', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom message="trace is not iterable" />
      </ErrorBoundary>,
    );

    await user.click(screen.getByText('crash.detail'));

    expect(screen.getByText(/trace is not iterable/)).toBeInTheDocument();
  });

  it('forgets the error when the reader moves on', () => {
    // Without this one broken page is a broken application: the error state
    // would survive every navigation, and only a reload would clear it.
    const { rerender } = render(
      <ErrorBoundary resetKey="/deployments">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('crash.title')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/dashboard">
        <p>another page</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('another page')).toBeInTheDocument();
    expect(screen.queryByText('crash.title')).not.toBeInTheDocument();
  });

  it('holds the message while the reader stays where they are', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/dashboard">
        <Boom />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary resetKey="/dashboard">
        <p>the page</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('crash.title')).toBeInTheDocument();
  });

  it('renders the children again when asked to try once more', async () => {
    // A render that failed on a value since replaced succeeds on the second
    // try, and a reload costs the session's whole state to find that out.
    let broken = true;
    const Sometimes = () => (broken ? <Boom /> : <p>the page</p>);
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Sometimes />
      </ErrorBoundary>,
    );

    broken = false;
    await user.click(screen.getByText('crash.retry'));

    expect(screen.getByText('the page')).toBeInTheDocument();
  });
});
