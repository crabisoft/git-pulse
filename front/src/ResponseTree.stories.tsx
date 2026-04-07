import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResponseTree } from './ResponseTree';

/**
 * The response a version endpoint answered, as something to click through.
 *
 * It has stories because the shapes it has to stay readable across are the
 * whole difficulty: a flat JSON answer, an XML document normalised into arrays,
 * a list that needs an index, and a key nothing can address. Each produces a
 * different path from the same gesture, and getting one of them wrong is a rule
 * that saves cleanly and reads nothing.
 */
const meta = {
  title: 'Controls/ResponseTree',
  component: ResponseTree,
  args: { onPick: (path: string) => console.log(path) },
} satisfies Meta<typeof ResponseTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What most endpoints answer. Clicking `1.4.2` yields `build.version`. */
export const Json: Story = {
  args: {
    value: {
      app: 'portal',
      build: { version: '1.4.2', number: '87', time: '2026-08-01T09:12:00Z' },
    },
  },
};

/**
 * XML as the backend normalises it: every element an array, attributes prefixed
 * with `@`, text under `#text`. A lone element carries no index in its path —
 * which is what keeps the path working the day a second one appears.
 */
export const Xml: Story = {
  args: {
    value: {
      info: [{ build: [{ version: ['1.4.2'], '@scm': 'git' }] }],
    },
  },
};

/** Several elements: the path has to say which, so each carries its index. */
export const AList: Story = {
  args: {
    value: {
      components: [
        { name: 'front', version: '2.0.0' },
        { name: 'back', version: '1.4.2' },
      ],
    },
  },
};

/**
 * A key holding a dot cannot be spelled as a step of the path language. Shown,
 * and deliberately not offered: a path built from it would parse as two steps
 * and quietly read nothing.
 */
export const Unaddressable: Story = {
  args: { value: { 'build.version': '1.4.2', ok: 'true' } },
};
