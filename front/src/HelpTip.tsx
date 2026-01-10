import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpIcon } from './icons';

/**
 * Question-mark button revealing an explanation.
 *
 * Shown on hover, which is what a reader expects of a `?`. Hover alone would
 * put it out of reach of two kinds of visitor, so two more openings are kept:
 * keyboard focus, and a click that pins it open — a tap is a click and never a
 * hover, which is the only way a touch device gets at it at all.
 *
 * Pinned, it survives the pointer leaving; Escape or a click elsewhere closes
 * it. The handlers sit on the wrapper rather than on the button so moving the
 * pointer onto the text itself does not count as leaving.
 */
export function HelpTip({ text }: { text: string }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  /** Clicked open, so it stays whatever the pointer does next. */
  const [pinned, setPinned] = useState(false);
  /**
   * Whether the focus about to land came from the pointer. A click focuses the
   * button, and counting that as a keyboard opening would latch the tip open —
   * a second click could then never close it.
   */
  const fromPointer = useRef(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const open = hovered || focused || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pinned]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      className="help-tip"
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`help-btn${open ? ' is-open' : ''}`}
        onClick={() => setPinned((p) => !p)}
        onMouseDown={() => {
          fromPointer.current = true;
        }}
        onFocus={() => {
          if (!fromPointer.current) setFocused(true);
          fromPointer.current = false;
        }}
        onBlur={() => {
          setFocused(false);
          fromPointer.current = false;
        }}
        aria-label={t('common.help')}
        // Described by, not expanded: what appears explains the button rather
        // than being a section it opens.
        aria-describedby={open ? id : undefined}
      >
        <HelpIcon size={15} />
      </button>
      {open && (
        <span className="help-pop" id={id} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
