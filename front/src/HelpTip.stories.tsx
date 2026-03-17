import type { Meta, StoryObj } from '@storybook/react-vite';
import { HelpTip } from './HelpTip';

/**
 * The `?` beside a metric name, holding what the number actually measures.
 *
 * Every DORA metric on the page carries one, because a value with no
 * definition beside it is where two people read the same figure differently.
 */
const meta = {
  title: 'Controls/HelpTip',
  component: HelpTip,
  args: {
    text:
      'Time from a change’s first commit to the deployment that carried it. ' +
      'Read it as an upper bound: a change merged just before a deployment ' +
      'that did not include it is attributed to it anyway.',
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HelpTip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Beside a heading, which is where they all live. */
export const InAHeading: Story = {
  render: (args) => (
    <h3 className="with-help">
      Lead time <HelpTip {...args} />
    </h3>
  ),
};

export const Short: Story = { args: { text: 'Deployments over the period.' } };
