import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from './index';
import en from './locales/en.json';
import fr from './locales/fr.json';

/**
 * The one suite that runs the real i18n.
 *
 * Every other suite in this package is handed a stub `t` that answers with its
 * key — see `test-setup`, and the trade it makes is the right one for a test
 * about what a component *does*. The cost is that nothing here ever exercises
 * i18next itself, or the wiring between it and React: a major bump of either
 * lands with every one of those suites still green.
 *
 * Which is not a hypothetical. `react-i18next@17` moved its peer floor to
 * `i18next >= 26`; the range this package declared still said `^23`, so npm
 * settled it by installing a second copy of i18next beside the first, and the
 * suites had nothing to say about it. Only the typecheck did.
 *
 * So this file unstubs the pair and holds them to what the app actually asks of
 * them — starting with there being one of them.
 */
vi.unmock('react-i18next');

const require = createRequire(import.meta.url);

/** A sentence off the catalogue, reached the way a component reaches one. */
function Sentence({ code, values }: { code: string; values?: Record<string, unknown> }) {
  const { t } = useTranslation();
  return <p>{t(code, values)}</p>;
}

/**
 * The instance is a singleton configured once at import, so a test that leaves
 * it speaking French hands the next one a language it never asked for.
 */
afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('the i18n wiring', () => {
  it('resolves one i18next, and shares it with react-i18next', () => {
    // What a peer bump breaks quietly. Two copies are two unrelated `TFunction`
    // types to the compiler, and wherever the types are not in the way, they
    // leave react-i18next reading an instance the app never initialised.
    const app = require.resolve('i18next');
    const library = require.resolve('i18next', {
      paths: [dirname(require.resolve('react-i18next'))],
    });
    expect(library).toBe(app);
  });

  it('puts the initialised instance within reach of a component', () => {
    // No provider, on purpose: `initReactI18next` is the whole mechanism by
    // which `useTranslation` finds this instance, and `App` wraps nothing.
    render(<Sentence code="nav.overview" />);
    expect(screen.getByText(en.nav.overview)).toBeInTheDocument();
  });

  it('fills the holes a message leaves', () => {
    render(<Sentence code="auth.passwordHint" values={{ min: 12 }} />);
    expect(screen.getByText(en.auth.passwordHint.replace('{{min}}', '12'))).toBeInTheDocument();
  });

  // Counting is the one piece of the catalogue the API cannot check for itself:
  // it sends `count` and the plural rule for the reader's language picks the
  // sentence, so a change in how that rule is applied is invisible to `back`.
  it.each([
    [1, en.sources.probe.ok_one],
    [4, en.sources.probe.ok_other],
  ])('picks the form that agrees with %i', (count, message) => {
    render(<Sentence code="sources.probe.ok" values={{ count }} />);
    expect(screen.getByText(message.replace('{{count}}', String(count)))).toBeInTheDocument();
  });

  it('redraws what is on screen when the account states a language', async () => {
    // `App` answers a stated language with `changeLanguage` and nothing else —
    // every sentence already rendered is expected to follow on its own.
    render(<Sentence code="nav.overview" />);
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(screen.getByText(fr.nav.overview)).toBeInTheDocument();
  });

  it('reads a region variant as the language it is', async () => {
    // A browser says `fr-FR` and the catalogue is filed under `fr`; `load` and
    // `nonExplicitSupportedLngs` are what close that gap.
    await act(async () => {
      await i18n.changeLanguage('fr-FR');
    });
    expect(i18n.resolvedLanguage).toBe('fr');
  });

  it('falls back to English for a language it does not keep', async () => {
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('answers a missing message with its own key', () => {
    // The premise `catalogue.spec` is written on: a code with no sentence
    // behind it reaches the screen as itself rather than as blank space, which
    // is why a catalogue gone out of step is worth a suite of its own.
    render(<Sentence code="errors.nothing.here" />);
    expect(screen.getByText('errors.nothing.here')).toBeInTheDocument();
  });
});
