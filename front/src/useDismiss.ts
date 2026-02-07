import { useEffect, type RefObject } from 'react';

/**
 * Closes a thing that hangs over the page when the page is used around it.
 *
 * Shared because the rules are not obvious and getting one of them wrong is
 * invisible until somebody is stuck: the account menu and the navigation drawer
 * both need exactly these three, and a second copy would drift.
 *
 * `returnFocusTo` is the control that opened it. Handing the focus back matters
 * only for the keyboard, and only on Escape — a click has already moved it
 * somewhere the person chose.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  returnFocusTo?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      // Dismissed by the keyboard, it must not leave the keyboard at the top of
      // the document.
      returnFocusTo?.current?.focus();
    };

    // Pointer down rather than click: one that closes only once the button is
    // released stays open under the finger for the length of a tap.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, root, returnFocusTo]);
}
