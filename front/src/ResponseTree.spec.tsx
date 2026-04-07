import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResponseTree } from './ResponseTree';

function pickFrom(value: unknown) {
  const onPick = vi.fn();
  render(<ResponseTree value={value} onPick={onPick} />);
  return onPick;
}

describe('the path a click produces', () => {
  it('descends through keys', async () => {
    const onPick = pickFrom({ build: { version: '1.4.2', number: '87' } });
    await userEvent.click(screen.getByRole('button', { name: '1.4.2' }));

    expect(onPick).toHaveBeenCalledWith('build.version');
  });

  // The resolver steps through a single-element array on its own, so leaving
  // the index out is what keeps the path working once a second element lands —
  // the XML trap the normalisation exists to close.
  it('leaves out the index of a lone element', async () => {
    const onPick = pickFrom({ info: [{ version: ['1.4.2'] }] });
    await userEvent.click(screen.getByRole('button', { name: '1.4.2' }));

    expect(onPick).toHaveBeenCalledWith('info.version');
  });

  it('indexes an element that has siblings', async () => {
    const onPick = pickFrom({
      components: [
        { name: 'front', version: '2.0.0' },
        { name: 'back', version: '1.4.2' },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: '1.4.2' }));

    expect(onPick).toHaveBeenCalledWith('components[1].version');
  });

  // An element carrying attributes nests its text under `#text`; the resolver
  // reads through it, so the shorter path is what an author would write — and
  // it survives an attribute being added to the element later.
  it('reads through the text of an element with attributes', async () => {
    const onPick = pickFrom({ version: { '@scm': 'git', '#text': '1.4.2' } });
    await userEvent.click(screen.getByRole('button', { name: '1.4.2' }));

    expect(onPick).toHaveBeenCalledWith('version');
  });

  it('addresses an attribute', async () => {
    const onPick = pickFrom({ project: { '@version': '1.4.2' } });
    await userEvent.click(screen.getByRole('button', { name: '1.4.2' }));

    expect(onPick).toHaveBeenCalledWith('project.@version');
  });
});

describe('what cannot be addressed', () => {
  it('shows a key holding a separator without offering it', () => {
    render(<ResponseTree value={{ 'build.version': '1.4.2' }} onPick={vi.fn()} />);

    // Present — hiding it would leave somebody hunting for a value that is
    // plainly in their response.
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    // But not clickable: the path would parse as two steps and read nothing.
    expect(screen.queryByRole('button', { name: '1.4.2' })).toBeNull();
  });

  it('carries the refusal down to the values under it', () => {
    render(<ResponseTree value={{ 'a.b': { version: '1.4.2' } }} onPick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '1.4.2' })).toBeNull();
  });
});
