import { useTranslation } from 'react-i18next';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  type DisplayMode,
  type OverviewDirection,
} from '@repo/shared';
import { isAvailable } from './display';

/** Glyph per mode, in the order they are offered. */
const MODE_GLYPH: Record<DisplayMode, string> = { light: '☀', dark: '☾', system: '◐' };

/**
 * Changes how the page presents itself, from the page itself.
 *
 * The installation sets a default and an account may override it from its own
 * settings page, but neither is where somebody actually decides they want the
 * dark version — that happens while reading, and walking to a settings screen
 * to come back is not switching.
 *
 * Signed in, the choice is saved and follows the account everywhere. As a
 * visitor it lives in this browser: there is no account to hang it on, and a
 * wall screen still deserves to be set to dark once and left alone.
 */
export function DisplaySwitch({
  direction,
  mode,
  onChange,
  disabled,
}: {
  direction: OverviewDirection;
  mode: DisplayMode;
  onChange: (next: { direction?: OverviewDirection; mode?: DisplayMode }) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="display-switch">
      <label className="filter-field">
        <span className="sr-only">{t('display.directionLabel')}</span>
        <select
          value={direction}
          disabled={disabled}
          title={t('display.directionLabel')}
          onChange={(e) => onChange({ direction: e.target.value as OverviewDirection })}
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

      <div className="mode-switch" role="group" aria-label={t('display.modeLabel')}>
        {DISPLAY_MODES.map((value) => (
          <button
            key={value}
            type="button"
            className="mode-btn"
            aria-pressed={mode === value}
            aria-label={t(`display.mode.${value}`)}
            title={t(`display.mode.${value}`)}
            disabled={disabled}
            onClick={() => onChange({ mode: value })}
          >
            <span aria-hidden="true">{MODE_GLYPH[value]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
