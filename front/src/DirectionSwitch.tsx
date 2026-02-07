import { useTranslation } from 'react-i18next';
import { OVERVIEW_DIRECTIONS, type OverviewDirection } from '@repo/shared';
import { isAvailable } from './display';

/**
 * Which reading of the dashboard is on show, chosen from the dashboard itself.
 *
 * The installation sets a default and an account may override it from its own
 * settings page, but neither is where somebody actually decides they want the
 * instruments rather than the board — that happens while reading, and walking
 * to a settings screen to come back is not switching.
 *
 * Signed in, the choice is saved and follows the account everywhere. As a
 * visitor it lives in this browser: there is no account to hang it on, and a
 * wall screen still deserves to be set once and left alone.
 *
 * Light and dark are not offered here. The top bar carries that switch on
 * every page, and a second one on this page alone was the same question asked
 * twice, in two different shapes.
 */
export function DirectionSwitch({
  direction,
  onChange,
  disabled,
}: {
  direction: OverviewDirection;
  onChange: (next: OverviewDirection) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <label className="filter-field direction-switch">
      <span className="sr-only">{t('display.directionLabel')}</span>
      <select
        value={direction}
        disabled={disabled}
        title={t('display.directionLabel')}
        onChange={(e) => onChange(e.target.value as OverviewDirection)}
      >
        {OVERVIEW_DIRECTIONS.map((value) => (
          // Kept visible rather than hidden: knowing the other directions
          // exist and are coming is worth more than a shorter list.
          <option key={value} value={value} disabled={!isAvailable(value)}>
            {t(`display.direction.${value}`)}
            {isAvailable(value) ? '' : ` — ${t('display.soon')}`}
          </option>
        ))}
      </select>
    </label>
  );
}
