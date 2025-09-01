import { useTranslation } from 'react-i18next';
import { PAGE_LIMIT_MAX, type PageInfo } from '@repo/shared';
import type { PageQuery } from './api';

/** Page sizes offered in the selector; the last one is the backend cap. */
const PAGE_SIZES = [10, 25, 50, 100, PAGE_LIMIT_MAX];

/**
 * Page size selector plus prev/next, driving a `PageQuery` held by the parent.
 * Renders nothing while a single page covers everything.
 */
export function Pagination({
  info,
  value,
  onChange,
  disabled,
}: {
  info: PageInfo;
  value: PageQuery;
  onChange: (next: PageQuery) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { total, limit, offset, hasMore } = info;

  if (offset === 0 && !hasMore) return null;

  const first = total === 0 ? 0 : offset + 1;
  const last = offset + Math.min(limit, Math.max(total - offset, 0));
  // The configured page size is rarely one of the presets — offer it too, so the
  // selector always shows the window actually applied.
  const sizes = [...new Set([...PAGE_SIZES, limit])].sort((a, b) => a - b);

  return (
    <div className="pagination">
      <span className="muted">{t('pagination.range', { first, last, total })}</span>
      <div className="pagination-controls">
        <label className="pagination-size">
          {t('pagination.perPage')}
          <select
            value={limit}
            disabled={disabled}
            // Resetting the offset keeps the window valid whatever the new size.
            onChange={(e) => onChange({ ...value, limit: Number(e.target.value), offset: 0 })}
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={disabled || offset === 0}
          onClick={() => onChange({ ...value, offset: Math.max(offset - limit, 0) })}
        >
          {t('pagination.previous')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || !hasMore}
          onClick={() => onChange({ ...value, offset: offset + limit })}
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
