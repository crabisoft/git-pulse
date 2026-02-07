import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { SUPPORTED_LANGUAGES } from '@repo/shared';
import en from './locales/en.json';
import fr from './locales/fr.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: 'en',
    // Map region variants (e.g. fr-FR → fr) onto the supported languages.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    /**
     * The browser decides, and nothing here remembers otherwise.
     *
     * An account that stated a language has it applied as soon as the session
     * is known — see `App`. One that stated none reads in the language of the
     * machine it is on, which is a better guess than any default stored here,
     * and a better one than a copy of what somebody picked on this browser
     * once. Nothing is cached for that reason: the account is the only memory.
     */
    detection: { order: ['navigator', 'htmlTag'], caches: [] },
    interpolation: { escapeValue: false },
  });

export default i18n;
