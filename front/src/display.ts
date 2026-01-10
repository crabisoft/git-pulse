import type { DisplayMode, DisplayPreference, OverviewDirection } from '@repo/shared';

/**
 * How the application presents itself, and when.
 *
 * The preference lives on the server — an installation default an admin sets,
 * overridden by whatever an account chose for itself. Neither has arrived when
 * the first pixel is painted, so both are mirrored into `localStorage` and the
 * inline script in `index.html` reads that copy before React mounts. Without
 * it every load of a dark install flashes white, which is the detail that
 * makes an application feel unfinished.
 *
 * The copy is a cache and never the authority: the moment the real preference
 * arrives it is applied and the copy is rewritten.
 */
export const MODE_KEY = 'display.mode';
export const DIRECTION_KEY = 'display.direction';

/** What `data-mode` may hold — `system` is resolved before it is stamped. */
export type ResolvedMode = 'light' | 'dark';

/**
 * The directions this build can actually render.
 *
 * Every control that offers a direction reads this list rather than the shared
 * type, so nobody — reader or admin — can select one that would render
 * nothing, and a direction added to a build turns all of them on at once.
 */
export const AVAILABLE_DIRECTIONS: readonly OverviewDirection[] = [
  'control',
  'instrument',
  'stream',
];

export function isAvailable(direction: OverviewDirection): boolean {
  return AVAILABLE_DIRECTIONS.includes(direction);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The mode in effect, with `system` handed back to the operating system. */
export function resolveMode(mode: DisplayMode): ResolvedMode {
  if (mode !== 'system') return mode;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * The preference that wins. An account that chose nothing follows the
 * installation, which is what lets an admin move everyone who never expressed
 * a preference — something a copy taken at sign-up would stop doing.
 */
export function effective(
  settings: { overviewDirection: OverviewDirection; displayMode: DisplayMode } | null,
  user: DisplayPreference | null | undefined,
): { direction: OverviewDirection; mode: DisplayMode } {
  return {
    direction: user?.direction ?? settings?.overviewDirection ?? 'control',
    mode: user?.mode ?? settings?.displayMode ?? 'system',
  };
}

/** Stamps the choice on the root element and mirrors it for the next load. */
export function apply(preference: { direction: OverviewDirection; mode: DisplayMode }): void {
  const root = document.documentElement;
  root.dataset.mode = resolveMode(preference.mode);
  root.dataset.direction = preference.direction;
  try {
    localStorage.setItem(MODE_KEY, preference.mode);
    localStorage.setItem(DIRECTION_KEY, preference.direction);
  } catch {
    // A browser refusing storage — private window, disabled cookies — costs a
    // flash on the next load and nothing else. Not worth telling anyone about.
  }
}

/**
 * Re-applies the mode as the operating system changes it. Only `system` cares:
 * an explicit choice is not a preference the machine gets to revise. Returns
 * the unsubscribe.
 */
export function watchSystem(mode: DisplayMode, onChange: () => void): () => void {
  if (mode !== 'system') return () => {};
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
