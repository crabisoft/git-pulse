import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DisplayMode, OverviewDirection } from '@repo/shared';
import { ThemeToggle } from './ThemeToggle';
import { DirectionSwitch } from './DirectionSwitch';

/**
 * The two controls that decide how the application presents itself.
 *
 * They are stateful in the app — the choice is stored on the account and
 * mirrored into `localStorage` so a dark install does not flash white on load
 * — so the stories hold that state themselves. Pressing them here moves the
 * control and nothing else; the toolbar above is what repaints the story.
 */
function Toggles({ mode: initialMode }: { mode: DisplayMode }) {
  const [mode, setMode] = useState<DisplayMode>(initialMode);
  return <ThemeToggle mode={mode} onChange={setMode} />;
}

const meta = {
  title: 'Controls/Display',
  component: Toggles,
  args: { mode: 'system' },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Toggles>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Three states rather than two: following the machine is a choice of its own,
 * and the icon says which one is in effect.
 */
export const FollowingTheSystem: Story = {};
export const Light: Story = { args: { mode: 'light' } };
export const Dark: Story = { args: { mode: 'dark' } };

/**
 * The overview's direction — three compositions of the same data, not three
 * repaints of one. Only the directions this build can actually render are
 * offered, so nobody can select one that would draw nothing.
 */
export const Direction: StoryObj = {
  render: function DirectionStory() {
    const [direction, setDirection] = useState<OverviewDirection>('control');
    return <DirectionSwitch direction={direction} onChange={setDirection} />;
  },
};

export const DirectionDisabled: StoryObj = {
  render: () => <DirectionSwitch direction="instrument" onChange={() => {}} disabled />,
};
