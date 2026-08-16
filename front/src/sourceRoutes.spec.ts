import { describe, expect, it } from 'vitest';
import { samePageOn, slugOf } from './sourceRoutes';

describe('slugOf', () => {
  it('reads the slug of a source page', () => {
    expect(slugOf('/dora/acme')).toBe('acme');
    expect(slugOf('/dora/acme/lead_time')).toBe('acme');
  });

  it('is null where no page is scoped to a source', () => {
    expect(slugOf('/settings/sources')).toBeNull();
    expect(slugOf('/account')).toBeNull();
  });
});

describe('samePageOn', () => {
  it('keeps the page and swaps the source', () => {
    expect(samePageOn('/dashboard/acme', 'globex')).toBe('/dashboard/globex');
    expect(samePageOn('/deployments/acme/changes', 'globex')).toBe('/deployments/globex/changes');
  });

  it('keeps the sub-page a source is being read from', () => {
    // The metric page used to throw for want of its `:metric`, leaving the
    // picker changed and the page where it was.
    expect(samePageOn('/dora/acme/lead_time', 'globex')).toBe('/dora/globex/lead_time');
  });

  it('has nowhere to go from a page without a source', () => {
    expect(samePageOn('/settings/users', 'globex')).toBeNull();
  });

  it('reads the new source over the period the old one was read over', () => {
    expect(samePageOn('/dora/acme', 'globex', '?windowDays=90')).toBe('/dora/globex?windowDays=90');
    expect(samePageOn('/dora/acme/mttr', 'globex', '?from=2026-01-01&to=2026-03-31')).toBe(
      '/dora/globex/mttr?from=2026-01-01&to=2026-03-31',
    );
  });

  it('leaves behind what only the old source could mean', () => {
    // A dimension slice, a repo, an environment: values the source defines, and
    // that the next one may not have any of.
    expect(
      samePageOn('/dora/acme', 'globex', '?windowDays=30&dimension=client:acme&repos=acme/api'),
    ).toBe('/dora/globex?windowDays=30');
    expect(samePageOn('/deployments/acme', 'globex', '?environment=prod&status=success')).toBe(
      '/deployments/globex',
    );
  });
});
