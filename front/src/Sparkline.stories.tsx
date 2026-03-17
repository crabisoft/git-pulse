import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sparkline } from './Sparkline';

/**
 * A metric's recent history, at the size of a word.
 *
 * The tone is not the sign of the movement: a rising deployment frequency is
 * good news and a rising restore time is not, so whoever draws it says which.
 */
const FALLING = [190, 174, 168, 159, 150, 141, 133, 120, 111, 104, 97];
const RISING = [38, 41, 44, 43, 49, 52, 55, 58, 61, 60, 63];

const meta = {
  title: 'Controls/Sparkline',
  component: Sparkline,
  args: { values: RISING, tone: 'good' },
} satisfies Meta<typeof Sparkline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Good: Story = {};

export const Bad: Story = { args: { values: RISING, tone: 'bad' } };

/** Neutral is for a series nothing says is progress either way. */
export const Neutral: Story = { args: { values: FALLING, tone: 'neutral' } };

/** A lead time coming down — the same shape, read as good news. */
export const Falling: Story = { args: { values: FALLING, tone: 'good' } };

/**
 * One point is not a trend, and a flat line drawn from it would claim
 * stability the install has no basis for. It renders a dash instead.
 */
export const TooShortToPlot: Story = { args: { values: [42] } };

/** A young install: every capture since it was set up, and no more. */
export const AFewPoints: Story = { args: { values: [12, 19, 15] } };

export const Wider: Story = { args: { width: 220, height: 48 } };
