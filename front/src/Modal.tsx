import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CancelIcon } from './icons';

/**
 * Centered dialog: closes on backdrop click and on Escape. The caller owns the
 * body and the footer actions.
 */
export function Modal({
  title,
  label,
  subtitle,
  footer,
  onClose,
  children,
}: {
  title: ReactNode;
  /** Accessible name — required when the title is not plain text. */
  label: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
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
    </div>
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
