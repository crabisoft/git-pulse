import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformLink } from './PlatformLink';

function link(url: string | null) {
  return render(
    <PlatformLink url={url} title="Open the environment">
      Prod
    </PlatformLink>,
  );
}

describe('PlatformLink', () => {
  it('opens what the platform published', () => {
    link('https://prod.example.com');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://prod.example.com');
  });

  it('renders the text alone when there is nowhere to go', () => {
    link(null);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Prod')).toBeInTheDocument();
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/settings/users'])(
    'refuses to link %s',
    (url) => {
      // An environment's address is configuration somebody typed, not something
      // a platform reported: the backend refuses to store anything but http(s),
      // and this is the second lock on the same door — a `javascript:` href runs
      // as whoever clicked it, and a relative one goes into this dashboard while
      // claiming to leave it.
      link(url);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('Prod')).toBeInTheDocument();
    },
  );

  it('is not fooled by a scheme padded to look absolute', () => {
    link(' javascript:alert(1)');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
