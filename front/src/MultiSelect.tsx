import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Select, { components, type MenuListProps, type MultiValue } from 'react-select';

export interface MultiSelectOption {
  value: string;
  /** Plain text: this is what the built-in search filters on. */
  label: string;
  /** Secondary detail shown beside the label, and searchable with it. */
  hint?: string;
}

/**
 * Multiple selection with removable chips, type-to-filter and select-all.
 *
 * Wraps react-select in `unstyled` mode: the behaviour — keyboard, ARIA roles,
 * filtering, the menu escaping its container — is what the library is for, the
 * looks stay ours through the app's own CSS variables. A styled import would
 * have brought a second visual language into every form.
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
  const value = useMemo(
    () => options.filter((option) => selected.has(option.value)),
    [options, selected],
  );

  return (
    <Select
      unstyled
      isMulti
      isSearchable
      closeMenuOnSelect={false}
      hideSelectedOptions={false}
      isDisabled={disabled || options.length === 0}
      options={options}
      value={value}
      onChange={(next: MultiValue<MultiSelectOption>) =>
        onChange(new Set(next.map((option) => option.value)))
      }
      placeholder={emptyLabel}
      noOptionsMessage={() => t('common.noMatch')}
      // Rendered against the body, so a menu opening near the bottom of a
      // scrolling modal is not clipped by it.
      menuPortalTarget={typeof document === 'undefined' ? undefined : document.body}
      menuPosition="fixed"
      formatOptionLabel={(option: MultiSelectOption, meta) =>
        meta.context === 'menu' && option.hint ? (
          <>
            {option.label} <span className="muted">({option.hint})</span>
          </>
        ) : (
          option.label
        )
      }
      // Filtering on the hint too: a rule is often looked up by its target.
      filterOption={(candidate, input) =>
        `${candidate.data.label} ${candidate.data.hint ?? ''}`
          .toLowerCase()
          .includes(input.toLowerCase())
      }
      components={{ MenuList: MenuListWithBulkActions }}
      classNamePrefix="ms"
      className={block ? 'ms block' : 'ms'}
      classNames={CLASS_NAMES}
    />
  );
}

/** Select-all and clear, pinned above the list while it scrolls. */
function MenuListWithBulkActions(props: MenuListProps<MultiSelectOption, true>) {
  const { t } = useTranslation();
  const all = props.options as MultiSelectOption[];
  const selectedCount = props.getValue().length;

  return (
    <>
      <div className="ms__bulk">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.setValue(all, 'select-option')}
          disabled={selectedCount === all.length}
        >
          {t('common.selectAll')}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.setValue([], 'deselect-option')}
          disabled={selectedCount === 0}
        >
          {t('common.clear')}
        </button>
        <span className="muted">
          {t('common.selectedCount', { count: selectedCount, total: all.length })}
        </span>
      </div>
      <components.MenuList {...props} />
    </>
  );
}

/**
 * One class per part, so the whole look lives in styles.css next to the rest
 * rather than in an inline style object here.
 */
const CLASS_NAMES = {
  control: ({ isFocused, isDisabled }: { isFocused: boolean; isDisabled: boolean }) =>
    ['ms__control', isFocused && 'is-focused', isDisabled && 'is-disabled']
      .filter(Boolean)
      .join(' '),
  valueContainer: () => 'ms__values',
  placeholder: () => 'ms__placeholder',
  multiValue: () => 'ms__chip',
  multiValueLabel: () => 'ms__chip-label',
  multiValueRemove: () => 'ms__chip-remove',
  input: () => 'ms__input',
  indicatorsContainer: () => 'ms__indicators',
  clearIndicator: () => 'ms__clear',
  dropdownIndicator: () => 'ms__caret',
  menu: () => 'ms__menu',
  menuList: () => 'ms__list',
  option: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) =>
    ['ms__option', isFocused && 'is-focused', isSelected && 'is-selected'].filter(Boolean).join(' '),
  noOptionsMessage: () => 'ms__empty',
} as const;
