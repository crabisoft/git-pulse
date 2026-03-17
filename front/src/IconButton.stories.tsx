import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconButton } from './IconButton';
import { CopyButton } from './CopyButton';
import { DeleteIcon, EditIcon, SyncIcon, TestIcon } from './icons';

/**
 * A button that is only an icon, and therefore always carries a name for
 * whoever cannot see it.
 */
const meta = {
  title: 'Controls/IconButton',
  component: IconButton,
  args: { label: 'Edit', onClick: () => {}, children: <EditIcon /> },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Danger: Story = {
  args: { label: 'Delete', tone: 'danger', children: <DeleteIcon /> },
};

export const Disabled: Story = {
  args: { label: 'Collect now', disabled: true, children: <SyncIcon /> },
};

/** The row a source carries in the settings — the shape they are used in. */
export const ARow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '.5rem' }}>
      <IconButton label="Test the connection" onClick={() => {}}>
        <TestIcon />
      </IconButton>
      <IconButton label="Collect now" onClick={() => {}}>
        <SyncIcon />
      </IconButton>
      <IconButton label="Edit" onClick={() => {}}>
        <EditIcon />
      </IconButton>
      <IconButton label="Delete" tone="danger" onClick={() => {}}>
        <DeleteIcon />
      </IconButton>
    </div>
  ),
};

/**
 * Its cousin: copies and then says so for a moment, because a button that
 * looks identical before and after leaves the reader pressing it twice.
 */
export const Copy: StoryObj<typeof CopyButton> = {
  render: () => <CopyButton text="https://example.com/api/webhooks/src-1" label="Copy the URL" />,
};
