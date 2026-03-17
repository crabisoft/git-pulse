import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The workshop, for the controls the pages are built from.
 *
 * Deliberately not for the pages themselves: those need the router, the API
 * and a session, and the layout suite under `e2e/` already renders them in a
 * real engine over stubbed answers. Duplicating that here would be two
 * harnesses to keep in step and one of them would rot.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
};

export default config;
