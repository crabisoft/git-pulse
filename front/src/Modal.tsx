import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CancelIcon } from './icons';

/**
 * Centered dialog: closes on backdrop click and on Escape. The caller owns the
 * body and the footer actions.
 *
 * Rendered into `<body>` rather than where it was written, for the reason the
 * multiselect's menu already is: a dialog belongs to the window, not to the box
 * that opened it. `position: fixed` only means "against the window" while no
 * ancestor is a containing block for it — and the shell became one when it
 * started publishing its width to the wide tables inside it. A dialog anchored
 * to the shell would sit at the top of the document, off screen, on any page
 * that had been scrolled.
 */
export function Modal({
  title,
  label,
  subtitle,
  footer,
  onClose,
  wide,
  children,
}: {
  title: ReactNode;
  /** Accessible name — required when the title is not plain text. */
  label: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /**
   * For a dialog holding two panes side by side rather than a form. The default
   * width is what a column of fields wants; anything wider only spreads them.
   */
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle}
          </div>
          <button
            className="btn icon"
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <CancelIcon />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Destructive-action confirmation, used in place of window.confirm. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn danger" type="button" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}
