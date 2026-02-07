import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MultiSelect } from './MultiSelect';

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
  const options = useMemo(() => repos.map((repo) => ({ value: repo, label: repo })), [repos]);

  return (
    <div className="repo-filter">
      <span className="filter-label">{t('dashboard.filter.repos')}</span>
      <MultiSelect
        options={options}
        selected={selected}
        onChange={onChange}
        emptyLabel={t('dashboard.filter.all')}
        disabled={disabled}
      />
    </div>
  );
}
