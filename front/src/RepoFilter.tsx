import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Multiselect over the repos of a source. An empty selection means "all", which
 * is also what the API expects when the parameter is omitted.
 */
export function RepoFilter({
  repos,
  selected,
  onChange,
  disabled,
}: {
  repos: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
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

  const toggle = (repo: string) => {
    const next = new Set(selected);
    if (next.has(repo)) next.delete(repo);
    else next.add(repo);
    onChange(next);
  };

  const label =
    selected.size === 0
      ? t('dashboard.filter.all')
      : t('dashboard.filter.selected', { count: selected.size });

  return (
    <div className="repo-filter">
      <span className="repo-filter-label">{t('dashboard.filter.repos')}</span>
      <div className="multiselect" ref={ref}>
        <button
          type="button"
          className="multiselect-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={disabled}
        >
          <span>{label}</span>
          <span className="caret">▾</span>
        </button>
        {open && (
          <div className="multiselect-panel">
            <div className="multiselect-actions">
              <button type="button" onClick={() => onChange(new Set(repos))}>
                {t('dashboard.filter.selectAll')}
              </button>
              <button type="button" onClick={() => onChange(new Set())}>
                {t('dashboard.filter.clear')}
              </button>
            </div>
            <ul>
              {repos.map((r) => (
                <li key={r}>
                  <label>
                    <input type="checkbox" checked={selected.has(r)} onChange={() => toggle(r)} />
                    <span>{r}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
