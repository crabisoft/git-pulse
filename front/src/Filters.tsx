import { useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { DoraPeriod } from '@repo/shared';
import { windowLabel, windowOptions } from './doraWindow';
import { Modal } from './Modal';
import { MultiSelect } from './MultiSelect';

/**
 * The filter controls shared by every page that reports over a period and a set
 * of dimensions — DORA, deployments. They live here rather than inside the page
 * that happened to need them first, next to RepoFilter, which already did.
 *
 * The period part of a query: a rolling window, or explicit bounds.
 */
export type PeriodValue = { from?: string; to?: string; windowDays?: number };

/** Value of the option that opens the custom-period dialog. */
const CUSTOM = 'custom';

/**
 * One labelled control in a filter bar, for the pages whose filter is a plain
 * select rather than a widget of its own.
 *
 * It exists so those pages stop reaching for `.form`, which stacks its label
 * above its control: in a row that also holds a button, the stacked fields are
 * a head taller than everything beside them and nothing lines up. A filter bar
 * reads left to right — label, value, next filter — and that is the shape the
 * period and dimension filters already have.
 */
export function FilterField({
  label,
  hint,
  wide,
  narrow,
  children,
}: {
  label: string;
  /** What the control does when it is left alone, where that is worth saying. */
  hint?: string;
  /**
   * Takes whatever the row has left. For a field written into rather than
   * picked from: a search is a sentence somebody types, and the width it is
   * given is how much of it they can still read.
   */
  wide?: boolean;
  /**
   * Takes less than a filter's usual width, for a control whose values are
   * short and known to be: a version tag is a dozen characters where a
   * repository path is a sentence. What it buys is a row that stays one row —
   * the reason to reach for it is never the field itself, it is the two beside
   * it that would otherwise wrap.
   */
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={['filter-field', wide && 'wide', narrow && 'narrow'].filter(Boolean).join(' ')}>
      <span className="filter-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Bounds being edited, as the `YYYY-MM-DD` a date input speaks. Empty means open. */
type Bounds = { from: string; to: string };

/**
 * Reporting period: a rolling window picked from the presets, or explicit
 * bounds. Untouched, the dropdown shows the window resolved by the backend —
 * the one configured in the settings — so what you read is what you filter on.
 *
 * The bounds are edited in a dialog and applied in one go. Inline date inputs
 * would refetch on every keystroke the picker reports, and each fetch is a full
 * round of connector calls.
 */
export function PeriodFilter({
  value,
  effective,
  onChange,
  disabled,
}: {
  value: PeriodValue;
  /** What the backend resolved, so the active period is never a mystery. */
  effective?: DoraPeriod;
  onChange: (next: PeriodValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const custom = Boolean(value.from || value.to);
  // Nothing chosen yet: the report tells which window is in effect.
  const windowDays = value.windowDays ?? effective?.windowDays ?? null;
  /** Draft bounds while the dialog is open; nothing is fetched until applied. */
  const [draft, setDraft] = useState<Bounds | null>(null);

  /** Starts from the period in effect rather than from two empty fields. */
  const edit = () =>
    setDraft({
      from: value.from ?? (effective ? day(effective.from) : ''),
      to: value.to ?? (effective ? day(effective.to) : ''),
    });

  const pick = (picked: string) => {
    if (picked === CUSTOM) edit();
    else onChange({ from: undefined, to: undefined, windowDays: Number(picked) });
  };

  const apply = (bounds: Bounds) => {
    setDraft(null);
    onChange({ from: bounds.from || undefined, to: bounds.to || undefined, windowDays: undefined });
  };

  return (
    <div className="period-filter">
      <label>
        <span className="filter-label">{t('dora.period.window')}</span>
        <select
          // The dialog owns the selection while it is open, so cancelling it
          // snaps the dropdown back to the window still in effect.
          value={custom || draft ? CUSTOM : (windowDays ?? '')}
          disabled={disabled}
          onChange={(e) => pick(e.target.value)}
        >
          {/* Placeholder until the first report says which window is in effect. */}
          {windowDays === null && !custom && <option value="" disabled />}
          {windowOptions(windowDays).map((days) => (
            <option key={days} value={days}>
              {windowLabel(t, days)}
            </option>
          ))}
          <option value={CUSTOM}>{t('dora.period.custom')}</option>
        </select>
      </label>
      {custom ? (
        <button type="button" className="btn" onClick={edit} disabled={disabled}>
          {boundsLabel(t, value.from, value.to)}
        </button>
      ) : (
        effective && (
          <span className="muted period-effective">
            {t('dora.period.effective', {
              from: formatDay(effective.from),
              to: formatDay(effective.to),
            })}
          </span>
        )
      )}
      <button
        type="button"
        className="btn"
        onClick={() => onChange({ from: undefined, to: undefined, windowDays: undefined })}
        disabled={disabled || (!custom && value.windowDays === undefined)}
        title={t('dora.period.resetHint')}
      >
        {t('dora.period.reset')}
      </button>

      {draft && <PeriodDialog value={draft} onApply={apply} onClose={() => setDraft(null)} />}
    </div>
  );
}

/** Edits both bounds, then applies them as a single change. */
function PeriodDialog({
  value,
  onApply,
  onClose,
}: {
  value: Bounds;
  onApply: (bounds: Bounds) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [bounds, setBounds] = useState(value);
  // An inverted period is rejected by the API; catching it here keeps a
  // half-typed date from costing a round trip.
  const inverted = Boolean(bounds.from && bounds.to && bounds.from > bounds.to);
  const valid = Boolean(bounds.from || bounds.to) && !inverted;

  const title = t('dora.period.dialogTitle');
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
          <button className="btn primary" type="submit" form="dora-period-form" disabled={!valid}>
            {t('dora.period.apply')}
          </button>
        </>
      }
    >
      <form
        id="dora-period-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onApply(bounds);
        }}
      >
        <p className="muted">{t('dora.period.dialogHint')}</p>
        <label>
          {t('dora.period.from')}
          <input
            type="date"
            value={bounds.from}
            max={bounds.to || undefined}
            autoFocus
            onChange={(e) => setBounds((b) => ({ ...b, from: e.target.value }))}
          />
        </label>
        <label>
          {t('dora.period.to')}
          <input
            type="date"
            value={bounds.to}
            min={bounds.from || undefined}
            onChange={(e) => setBounds((b) => ({ ...b, to: e.target.value }))}
          />
        </label>
      </form>
    </Modal>
  );
}

/** Reads the pinned period back, including the half-open cases. */
function boundsLabel(t: TFunction, from?: string, to?: string): string {
  if (from && to) return t('dora.period.effective', { from: formatDay(from), to: formatDay(to) });
  if (from) return t('dora.period.since', { from: formatDay(from) });
  return t('dora.period.until', { to: formatDay(to!) });
}

/**
 * One select per dimension key discovered in the results (customer, app, ...).
 * The vocabulary comes from the unsliced computation, so a narrowing choice
 * never removes the options you would need to widen back.
 */
export function DimensionFilter({
  vocabulary,
  value,
  onChange,
  disabled,
}: {
  vocabulary: Record<string, string[]>;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const keys = Object.keys(vocabulary);
  if (keys.length === 0) return null;

  const pick = (key: string, picked: string) => {
    const next = { ...value };
    if (picked) next[key] = picked;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="dimension-filter">
      {keys.map((key) => (
        <label key={key}>
          <span className="filter-label">{key}</span>
          <select
            value={value[key] ?? ''}
            disabled={disabled}
            onChange={(e) => pick(key, e.target.value)}
          >
            <option value="">{t('dora.dimension.any')}</option>
            {vocabulary[key].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}
      {Object.keys(value).length > 0 && (
        <button type="button" className="btn" onClick={() => onChange({})} disabled={disabled}>
          {t('dora.dimension.clear')}
        </button>
      )}
    </div>
  );
}

/**
 * The meta-environments an environment may carry. Its own control rather than
 * one more entry in the dimension bar: a meta-environment is a name covering
 * several patterns, not an attribute extracted from one, and an environment
 * can hold more than one of them.
 */
export function MetaFilter({
  options,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <FilterField label={t('overview.filters.meta')}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('dora.dimension.any')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

/**
 * Which dimension the board folds on. Sits with the filters because it is read
 * as one — "prod, chez acme, par app" is a single sentence — even though it
 * narrows nothing and costs no request.
 */
export function GroupByFilter({
  keys,
  value,
  onChange,
  disabled,
}: {
  keys: string[];
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (keys.length === 0) return null;
  return (
    <FilterField label={t('overview.filters.groupBy')}>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{t('overview.filters.groupByNone')}</option>
        {keys.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

/**
 * A multiple choice over a closed vocabulary. The same control the repo filter
 * uses, because environments and statuses ask the user exactly the same thing —
 * and an empty selection means "every one", which is also what the API reads
 * from an omitted parameter.
 */
export function ChoiceFilter({
  label,
  anyLabel,
  options,
  value,
  onChange,
  disabled,
  translateOption,
}: {
  label: string;
  anyLabel: string;
  options: readonly string[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  translateOption?: (option: string) => string;
}) {
  const items = useMemo(
    () =>
      options.map((option) => ({
        value: option,
        label: translateOption ? translateOption(option) : option,
      })),
    [options, translateOption],
  );

  return (
    <div className="repo-filter">
      <span className="filter-label">{label}</span>
      <MultiSelect
        options={items}
        selected={new Set(value)}
        onChange={(next) => onChange([...next].sort())}
        emptyLabel={anyLabel}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * A date with no time parses as UTC midnight, which reads as the day before
 * west of Greenwich — pin it to local midnight so a bound displays as typed.
 */
function formatDay(value: string): string {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  return new Date(at).toLocaleDateString(undefined, { dateStyle: 'short' });
}

/** ISO timestamp to the `YYYY-MM-DD` a date input expects. */
function day(iso: string): string {
  return iso.slice(0, 10);
}
