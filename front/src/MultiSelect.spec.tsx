import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from './MultiSelect';

const OPTIONS = [
  { value: 'a', label: 'Alpha', hint: 'environment' },
  { value: 'b', label: 'Beta', hint: 'repository' },
  { value: 'c', label: 'Gamma', hint: 'incident' },
];

function setup(over: Partial<Parameters<typeof MultiSelect>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <MultiSelect
      options={OPTIONS}
      selected={new Set()}
      onChange={onChange}
      emptyLabel="nothing.selected"
      {...over}
    />,
  );
  return { onChange, view, user: userEvent.setup() };
}

const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('combobox'));

describe('MultiSelect', () => {
  it('shows the caller-supplied wording while nothing is selected', () => {
    setup();
    // What "empty" means differs per use, so the component never words it.
    expect(screen.getByText('nothing.selected')).toBeInTheDocument();
  });

  it('names the selection instead of only counting it', () => {
    setup({ selected: new Set(['a', 'b']) });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('nothing.selected')).not.toBeInTheDocument();
  });

  it('lists an option per choice once opened', async () => {
    const { user } = setup();
    await open(user);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('adds a value without dropping the ones already chosen', async () => {
    const { onChange, user } = setup({ selected: new Set(['a']) });
    await open(user);
    await user.click(screen.getByRole('option', { name: /Beta/ }));

    expect(onChange).toHaveBeenCalledWith(new Set(['a', 'b']));
  });

  it('removes a value from its chip, without opening the menu', async () => {
    const { onChange, user } = setup({ selected: new Set(['a', 'b']) });
    // react-select labels the remove control after the value it drops.
    await user.click(screen.getByRole('button', { name: /Remove Alpha/i }));

    expect(onChange).toHaveBeenCalledWith(new Set(['b']));
  });

  it('filters on the label and on the hint alike', async () => {
    const { user } = setup();
    await open(user);

    await user.type(screen.getByRole('combobox'), 'gam');
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.clear(screen.getByRole('combobox'));
    // A rule is often looked up by its target rather than by its name.
    await user.type(screen.getByRole('combobox'), 'repository');
    expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument();
  });

  it('says so when the search matches nothing', async () => {
    const { user } = setup();
    await open(user);
    await user.type(screen.getByRole('combobox'), 'zzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('common.noMatch')).toBeInTheDocument();
  });

  it('selects everything and clears everything through the shortcuts', async () => {
    const { onChange, user } = setup({ selected: new Set(['a']) });
    await open(user);

    await user.click(screen.getByRole('button', { name: 'common.selectAll' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(['a', 'b', 'c']));

    await user.click(screen.getByRole('button', { name: 'common.clear' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });

  it('disables a shortcut that would change nothing', async () => {
    const { user } = setup({ selected: new Set(['a', 'b', 'c']) });
    await open(user);

    expect(screen.getByRole('button', { name: 'common.selectAll' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.clear' })).toBeEnabled();
  });

  it('counts the selection against the total, above the list', async () => {
    const { user } = setup({ selected: new Set(['a', 'b']) });
    await open(user);

    const bulk = screen.getByRole('button', { name: 'common.selectAll' }).parentElement!;
    expect(within(bulk).getByText(/"count":2/)).toBeInTheDocument();
  });

  it('opens with the keyboard and picks without the mouse', async () => {
    const { onChange, user } = setup();
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    // Behaviour react-select brings and the hand-rolled control never had.
    expect(onChange).toHaveBeenCalledWith(new Set(['b']));
  });

  it('cannot be opened when there is nothing to choose from', () => {
    setup({ options: [], emptyLabel: 'declare.one.first' });

    // Disabled, react-select renders no input at all: nothing to focus, nothing
    // to open, and the reason stays on screen.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('declare.one.first')).toBeInTheDocument();
  });
});
