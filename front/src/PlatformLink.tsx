import type { ReactNode } from 'react';

/**
 * Something opened on the platform that hosts it — a deployment, an environment.
 *
 * The URL is read on the backend and travels with the payload rather than being
 * built here: what a platform publishes a page for is its own business, and
 * nothing in this UI names one. A missing URL renders the text alone, so the
 * absence of a page never costs the reader the fact itself.
 *
 * A new tab, like every other outward link here: the reader is going to look at
 * something, not leaving the filters they set behind.
 */
export function PlatformLink({
  url,
  title,
  children,
}: {
  url: string | null;
  /** What opens, for whoever hovers — the arrow alone does not say. */
  title: string;
  children: ReactNode;
}) {
  if (!url || !opensInABrowser(url)) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={title}>
      {children} ↗
    </a>
  );
}

/**
 * Absolute http(s) only, checked again here.
 *
 * Everything reaching this component should already be one — a platform's own
 * page, or an environment address the backend refuses to store otherwise — so
 * this catches what got past a check rather than what is expected. It is worth
 * the line because of where the value lands: an `href` runs a `javascript:` URL
 * as the reader who clicked it, and an environment's address is configuration
 * somebody typed, not something a platform reported.
 *
 * A rejected address renders as text, exactly like an absent one: the fact
 * survives, the link does not.
 */
function opensInABrowser(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
