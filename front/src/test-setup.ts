import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Translations are stubbed rather than loaded: what a component says is the
 * translators' business, what it *does* is what these suites check. `t` returns
 * the key, so an assertion naming a key stays readable and does not break every
 * time wording changes — which it does often.
 *
 * Both are defined once and handed back unchanged. A fresh `t` per render would
 * be a new identity in every dependency array that holds it, and hooks keyed on
 * it would re-run forever — the real one is stable, so the stub must be too.
 */
const t = (key: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length > 0 ? `${key}:${JSON.stringify(params)}` : key;
const i18n = { resolvedLanguage: 'en', changeLanguage: vi.fn() };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }));

/**
 * jsdom implements no media queries, and every component that renders one thing
 * for a phone and another for a desk asks for one. Stubbed as "not narrow", so
 * a suite gets the table it was written against; a suite about the other
 * rendering overrides this for itself.
 */
vi.stubGlobal(
  'matchMedia',
  (query: string) =>
    ({
      media: query,
      matches: false,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList,
);

afterEach(cleanup);
