import type { TFunction } from 'i18next';
import { DORA_WINDOW_PRESETS } from '@repo/shared';

/**
 * Wording of a lookback window: the presets read as durations ("3 months"),
 * anything else falls back to a plain day count. Both dropdowns — the DORA page
 * and the settings — label their options through here so a window means the
 * same thing wherever it is shown.
 */
export function windowLabel(t: TFunction, days: number): string {
  return DORA_WINDOW_PRESETS.includes(days)
    ? t(`dora.window.${days}`)
    : t('dora.window.days', { count: days });
}

/**
 * The presets, plus `current` when it is not one of them — a window stored
 * before the presets existed stays selectable instead of being silently
 * rewritten by the first save.
 */
export function windowOptions(current: number | null): number[] {
  if (current === null || DORA_WINDOW_PRESETS.includes(current)) return [...DORA_WINDOW_PRESETS];
  return [...DORA_WINDOW_PRESETS, current].sort((a, b) => a - b);
}
