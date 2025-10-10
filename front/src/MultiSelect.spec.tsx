import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from './MultiSelect';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function setup(over: Partial<Parameters<typeof MultiSelect>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <MultiSelect
      options={OPTIONS}
      selected={new Set()}
      onChange={onChange}
      emptyLabel="nothing.selected"
      {...over}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

const trigger = () => screen.getByRole('button', { expanded: false });

describe('MultiSelect', () => {
  it('shows the caller-supplied wording while nothing is selected', () => {
    setup();
    // What "empty" means differs per use, so the component never words it.
    expect(trigger()).toHaveTextContent('nothing.selected');
  });

  it('counts the selection against the total once there is one', () => {
    setup({ selected: new Set(['a', 'b']) });
    expect(screen.getByRole('button')).toHaveTextContent('"count":2');
    expect(screen.getByRole('button')).toHaveTextContent('"total":3');
  });

  it('opens on click and lists an option per choice', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('adds a value without dropping the ones already chosen', async () => {
    const { onChange, user } = setup({ selected: new Set(['a']) });
    await user.click(screen.getByRole('button', { expanded: false }));
    await user.click(screen.getByRole('checkbox', { name: 'Beta' }));

    expect(onChange).toHaveBeenCalledWith(new Set(['a', 'b']));
  });

  it('removes a value that was already chosen', async () => {
    const { onChange, user } = setup({ selected: new Set(['a', 'b']) });
    await user.click(screen.getByRole('button', { expanded: false }));
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));

    expect(onChange).toHaveBeenCalledWith(new Set(['b']));
  });

  it('selects everything and clears everything through the shortcuts', async () => {
    const { onChange, user } = setup({ selected: new Set(['a']) });
    await user.click(screen.getByRole('button', { expanded: false }));

    await user.click(screen.getByRole('button', { name: 'common.selectAll' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(['a', 'b', 'c']));

    await user.click(screen.getByRole('button', { name: 'common.clear' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });

  it('disables a shortcut that would change nothing', async () => {
    const { user } = setup({ selected: new Set(['a', 'b', 'c']) });
    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByRole('button', { name: 'common.selectAll' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.clear' })).toBeEnabled();
  });

  it('closes on a click outside, and not on one inside the panel', async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);

    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(3);

    await user.click(document.body);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('cannot be opened when there is nothing to choose from', () => {
    setup({ options: [], emptyLabel: 'declare.one.first' });
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('declare.one.first');
  });
});
