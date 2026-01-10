import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpTip } from './HelpTip';

const TEXT = 'Median time from a merge to production.';

function tip() {
  render(<HelpTip text={TEXT} />);
  return screen.getByRole('button', { name: 'common.help' });
}

describe('HelpTip', () => {
  it('explains on hover', async () => {
    const button = tip();
    await userEvent.hover(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent(TEXT);
  });

  it('stops explaining once the pointer leaves', async () => {
    const button = tip();
    await userEvent.hover(button);
    await userEvent.unhover(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('explains on keyboard focus, which hover never reaches', async () => {
    const button = tip();
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('stays open once clicked, whatever the pointer does next', async () => {
    // A tap is a click and never a hover: this is the whole of how a touch
    // device gets at the explanation.
    const button = tip();
    await userEvent.click(button);
    await userEvent.unhover(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes a pinned explanation on a second click', async () => {
    const button = tip();
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.unhover(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const button = tip();
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('points assistive technology at the explanation while it is shown', async () => {
    const button = tip();
    expect(button).not.toHaveAttribute('aria-describedby');
    await userEvent.hover(button);
    expect(button).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
  });
});
