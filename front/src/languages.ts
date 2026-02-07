import { SUPPORTED_LANGUAGES, type Language } from '@repo/shared';

/**
 * What each language calls itself.
 *
 * A module of its own, holding data and running nothing. It used to live beside
 * the i18next initialisation, which meant that a component offering a language
 * picker booted the whole translation stack just to read two labels — and that
 * every suite rendering one had to stub it away.
 *
 * Endonyms rather than translations: somebody looking for their own language
 * finds it under the name they know it by, whichever one the interface happens
 * to be in at the time.
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  fr: 'Français',
};

export { SUPPORTED_LANGUAGES, type Language };
