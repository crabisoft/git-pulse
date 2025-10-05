import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface MultiSelectOption {
  value: string;
  label: ReactNode;
}

/**
 * A dropdown holding checkboxes, with select-all and clear shortcuts. Used
 * wherever a list is long enough that laying every checkbox out would push the
 * rest of the form off screen — repo filters, and the catalogues a source opts
 * into.
 *
 * What an empty selection *means* is the caller's to say: on a filter it reads
 * as "no restriction", in a source form as "none applies". Hence `emptyLabel`
 * rather than a wording baked in here.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  emptyLabel,
  disabled,
  block,
}: {
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  emptyLabel: string;
  disabled?: boolean;
  /** Fills the width of its container, for form fields rather than filter bars. */
  block?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const label =
    selected.size === 0
      ? emptyLabel
      : t('common.selectedCount', { count: selected.size, total: options.length });

  return (
    <div className={block ? 'multiselect block' : 'multiselect'} ref={ref}>
      <button
        type="button"
        className="multiselect-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={disabled || options.length === 0}
      >
        <span>{options.length === 0 ? emptyLabel : label}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="multiselect-panel">
          <div className="multiselect-actions">
            <button
              type="button"
              onClick={() => onChange(new Set(options.map((o) => o.value)))}
              disabled={selected.size === options.length}
            >
              {t('common.selectAll')}
            </button>
            <button type="button" onClick={() => onChange(new Set())} disabled={selected.size === 0}>
              {t('common.clear')}
            </button>
          </div>
          <ul>
            {options.map((option) => (
              <li key={option.value}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(option.value)}
                    onChange={() => toggle(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
