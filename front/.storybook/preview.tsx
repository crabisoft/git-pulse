import type { Preview } from '@storybook/react-vite';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import { useEffect } from 'react';
import i18n from '../src/i18n';
import '../src/styles.css';

/**
 * What every story is rendered inside.
 *
 * Three things the application decides at runtime are toolbar switches here,
 * because they are exactly what a component can look right in one of and wrong
 * in another: the colour mode, the overview direction, and the language. The
 * first two are `data-` attributes on the root element — the same ones
 * `display.ts` stamps — so a story is styled by the application's own rules
 * rather than by anything Storybook holds.
 */
/**
 * Storybook 10.5.5 against itself, and the reason a story sometimes rendered
 * "The component failed to render properly" with `TypeError: Illegal
 * invocation`.
 *
 * Its test addon replaces `HTMLElement.prototype.focus` with an accessor whose
 * getter dereferences `this.ownerDocument` (`storybook/dist/csf`), to keep a
 * story from stealing focus during an interaction test. Its own UI components
 * vendor react-aria, whose `setupGlobalFocusEvents` reads
 * `HTMLElement.prototype.focus` — **on the prototype**, where `this` is not an
 * element, so the native `ownerDocument` getter throws. In jsdom that read
 * returns undefined, which is why it survives their tests and not a browser.
 *
 * Pinning the method as a non-configurable data property makes their
 * redefinition throw inside the `try/catch` it already sits in: the patch is
 * skipped, `userEvent` and the clipboard shim are untouched, and nothing reads
 * a getter that cannot be read. We run no interaction tests, so the behaviour
 * being skipped is behaviour we never asked for.
 *
 * Remove it when the upstream getter learns to guard its receiver.
 */
if (typeof HTMLElement !== 'undefined') {
  Object.defineProperty(HTMLElement.prototype, 'focus', {
    value: HTMLElement.prototype.focus,
    writable: true,
    enumerable: false,
    configurable: false,
  });
}

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // The surfaces are painted by styles.css against the mode; a background
    // picker on top of that would only ever show the wrong one.
    backgrounds: { disable: true },
    a11y: { test: 'todo' },
    // Stated rather than alphabetical: the page explaining what this is comes
    // before the tokens, and the tokens before the controls drawn with them.
    options: { storySort: { order: ['Get started', 'Foundations', 'Controls'] } },
  },

  initialGlobals: { direction: 'control', locale: 'en' },

  globalTypes: {
    direction: {
      description: 'Overview direction',
      toolbar: {
        icon: 'component',
        items: [
          { value: 'control', title: 'Control room' },
          { value: 'instrument', title: 'Instrument' },
          { value: 'stream', title: 'Stream' },
          { value: 'versions', title: 'Versions' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Language',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'fr', title: 'Français' },
        ],
        dynamicTitle: true,
      },
    },
  },

  decorators: [
    // `data-mode` on `<html>`: the attribute `display.ts` writes and every dark
    // rule in styles.css hangs off.
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-mode',
    }),
    (Story, context) => {
      const { locale } = context.globals as { locale: string };
      // A component that only exists in one direction says so with a
      // parameter, and it wins over the toolbar. Not a story-level global: a
      // docs page renders every story of a component into one document, and
      // the attribute below is one attribute on one root element for all of
      // them — so a per-story global would have the last to mount deciding
      // for its siblings, which is exactly how the gauges came out unpainted.
      const direction =
        (context.parameters.direction as string | undefined) ??
        (context.globals.direction as string);
      useEffect(() => {
        document.documentElement.dataset.direction = direction;
      }, [direction]);
      useEffect(() => {
        void i18n.changeLanguage(locale);
      }, [locale]);
      return <Story />;
    },
  ],

  // Every component gets its generated page without asking for it — the point
  // of the catalogue is that nothing is missing from it.
  tags: ['autodocs'],
};

export default preview;
