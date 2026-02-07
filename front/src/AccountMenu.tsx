import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import type { UserPublic } from '@repo/shared';
import { initials, nameHue } from './initials';
import { useDismiss } from './useDismiss';

/**
 * Who is signed in, and everything that concerns them alone.
 *
 * One control in the corner rather than a name, a button and a tab spread
 * across the bar: what an account does about itself, where the install is
 * configured from, and the way out all belong to the same person and to none
 * of the sections next to them.
 */
export function AccountMenu({
  user,
  isAdmin,
  onSignOut,
}: {
  user: UserPublic;
  isAdmin: boolean;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Closed by navigating, which is what every entry in it does. Without this
  // the menu would still be hanging over the page it just opened.
  useEffect(() => setOpen(false), [location.pathname]);
  useDismiss(open, useCallback(() => setOpen(false), []), root, button);

  const monogram = initials(user.name);

  return (
    <div className="account" ref={root}>
      <button
        ref={button}
        className="avatar"
        type="button"
        // The name is the label: the monogram is a shorthand for it, and a
        // screen reader has no use for the shorthand.
        aria-label={user.name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        style={{ '--avatar-hue': nameHue(user.name) } as React.CSSProperties}
        onClick={() => setOpen((was) => !was)}
      >
        {/* Hidden from the reading order rather than labelled: the button
            already says the name, and "JR" read out after it is noise. */}
        <span aria-hidden="true">{monogram}</span>
      </button>

      {open && (
        <div className="account-menu" id={menuId} role="menu">
          <div className="account-menu-head">
            <strong>{user.name}</strong>
            <span className="muted">{user.email}</span>
          </div>
          <Link className="account-menu-item" role="menuitem" to="/account">
            {t('auth.account')}
          </Link>
          {/* Hidden rather than disabled: to a visitor, the section does not
              exist — the same rule it followed as a tab. */}
          {isAdmin && (
            <Link className="account-menu-item" role="menuitem" to="/settings">
              {t('nav.settings')}
            </Link>
          )}
          <button
            className="account-menu-item danger"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
