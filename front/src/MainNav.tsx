import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { MenuIcon } from './icons';
import { useDismiss } from './useDismiss';

/**
 * The sections, in the order they are read.
 *
 * A list rather than five hand-written links: the same entries are a strip on a
 * wide screen and a drawer on a narrow one, and two copies of the markup would
 * be two places to forget a section.
 */
const SECTIONS = [
  { module: 'dashboard', path: '/dashboard', label: 'nav.overview' },
  { module: 'dora', path: '/dora', label: 'nav.dora' },
  { module: 'deployments', path: '/deployments', label: 'nav.deployments' },
  { module: 'changelogs', path: '/changelogs', label: 'nav.changelogs' },
  { module: 'release-notes', path: '/release-notes', label: 'nav.releaseNotes' },
] as const;

/**
 * Where the application can be taken from here.
 *
 * One nav element in the document whatever the width: below the breakpoint the
 * stylesheet folds it into a drawer and the button below reveals it, rather
 * than a second copy of the links being rendered and hidden. A screen reader
 * and a search of the DOM both find exactly one of each section.
 */
export function MainNav({
  module,
  withSource,
}: {
  /** The section being read, for the entry that marks itself current. */
  module: string;
  /** Adds the active source to a section's path, when there is one. */
  withSource: (base: string) => string;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const navId = useId();

  // Closed by navigating, which is what every entry in it does.
  useEffect(() => setOpen(false), [location.pathname]);
  useDismiss(open, useCallback(() => setOpen(false), []), root, button);

  return (
    <div className="main-nav" ref={root}>
      <button
        ref={button}
        className="burger"
        type="button"
        aria-label={t('nav.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={navId}
        onClick={() => setOpen((was) => !was)}
      >
        <MenuIcon />
      </button>
      <nav id={navId} className={open ? 'tabs open' : 'tabs'}>
        {SECTIONS.map((section) => (
          <Link
            key={section.module}
            className={module === section.module ? 'tab active' : 'tab'}
            // What a screen reader announces instead of the colour the strip
            // uses to say the same thing.
            aria-current={module === section.module ? 'page' : undefined}
            to={withSource(section.path)}
          >
            {t(section.label)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
