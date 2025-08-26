import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpIcon } from './icons';

/**
 * Question-mark button revealing an explanation. Toggled on click rather than
 * hover so it stays reachable on touch devices and with the keyboard.
 */
export function HelpTip({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="help-tip" ref={ref}>
      <button
        type="button"
        className="help-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('common.help')}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
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
