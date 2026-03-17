import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PageQuery } from './api';
import { Pagination } from './Pagination';

/**
 * The window on a list route: which slice is shown, and how to move it.
 *
 * Stateful by nature, so the stories hold the state a page would — pressing
 * *next* here moves the numbers, which is the only way to see that the last
 * page reports what it actually holds rather than a full one.
 */
function Stateful({ total, limit, disabled }: { total: number; limit: number; disabled?: boolean }) {
  const [page, setPage] = useState<PageQuery>({ limit, offset: 0 });
  const offset = page.offset ?? 0;
  const size = page.limit ?? limit;
  return (
    <Pagination
      info={{ total, limit: size, offset, hasMore: offset + size < total }}
      value={page}
      onChange={setPage}
      disabled={disabled}
    />
  );
}

const meta = {
  title: 'Controls/Pagination',
  component: Stateful,
  args: { total: 248, limit: 25 },
} satisfies Meta<typeof Stateful>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ManyPages: Story = {};

/**
 * Nothing at all. A list that fits in one page has nothing to page through,
 * and a control saying "1–8 of 8" beside it is furniture — so it renders
 * nothing rather than a disabled version of itself.
 */
export const SinglePage: Story = { args: { total: 8, limit: 25 } };

/** The page size the install configured is offered even when it is not a preset. */
export const ConfiguredPageSize: Story = { args: { total: 248, limit: 30 } };

/** While a request is in flight, so a burst of clicks cannot queue five of them. */
export const Disabled: Story = { args: { disabled: true } };
