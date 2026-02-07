import { useTranslation } from 'react-i18next';
import type { Branch, Tag } from '@repo/shared';

/**
 * One bound of the range. Tags and branches are both refs the platforms will
 * compare, but they answer different questions — "what went out in 2.1" versus
 * "what is on main since" — so they are offered in named groups rather than in
 * one flat list where a `release/3.0` would read as a version.
 */
export function RefSelect({
  value,
  onChange,
  autoLabel,
  tags,
  branches,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Label of the leading empty option; omitted, the control offers none. */
  autoLabel?: string;
  tags: Tag[];
  branches: Branch[];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {autoLabel !== undefined && <option value="">{autoLabel}</option>}
      {tags.length > 0 && (
        <optgroup label={t('releaseNotes.tags')}>
          {/* Listed newest first, which is the order the connector hands them
              back in — see `byTagDate`. The name is all a picker needs: the
              date decides the order and says nothing once it has. */}
          {tags.map((tag) => (
            <option key={`tag:${tag.name}`} value={tag.name}>
              {tag.name}
            </option>
          ))}
        </optgroup>
      )}
      {branches.length > 0 && (
        <optgroup label={t('releaseNotes.branches')}>
          {branches.map((branch) => (
            <option key={`branch:${branch.name}`} value={branch.name}>
              {branch.name}
              {/* Named because it is what an omitted bound resolves to on a
                  repo with no tag, not merely because it is the usual one. */}
              {branch.isDefault ? ` · ${t('releaseNotes.defaultBranch')}` : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
