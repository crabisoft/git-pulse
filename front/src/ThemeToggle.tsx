import { useTranslation } from 'react-i18next';
import { DISPLAY_MODES, type DisplayMode } from '@repo/shared';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/**
 * Light, dark, or whatever the machine says — from the bar, where it is looked
 * for.
 *
 * It cycles rather than toggling because there are three states and only one
 * of them is a preference about the room: `system` is the choice to have no
 * opinion, and a two-state switch would quietly throw it away the first time
 * anybody touched it.
 *
 * What it writes is what the account page wrote before it: the preference for
 * whoever is signed in, and this browser alone for whoever is not — see
 * `changeDisplay` in App.
 */
export function ThemeToggle({
  mode,
  onChange,
}: {
  mode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[mode];
  const next = DISPLAY_MODES[(DISPLAY_MODES.indexOf(mode) + 1) % DISPLAY_MODES.length];

  return (
    <button
      className="btn icon"
      type="button"
      // The label says the state, not the action: a control that announces
      // where it will go leaves a screen reader unable to ask where it is.
      aria-label={t('display.current', { mode: t(`display.mode.${mode}`) })}
      title={t('display.switchTo', { mode: t(`display.mode.${next}`) })}
      onClick={() => onChange(next)}
    >
      <Icon />
    </button>
  );
}
