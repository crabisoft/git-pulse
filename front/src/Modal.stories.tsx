import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmDialog, Modal } from './Modal';

/**
 * The dialog every form in the settings opens inside.
 *
 * Worth a story for one reason above the others: the body scrolls, and a menu
 * opening near the bottom of it used to be clipped by it — which is why the
 * multiselect portals its menu to the document. A long body is therefore one
 * of the stories rather than an afterthought.
 */
const meta = {
  title: 'Controls/Modal',
  component: Modal,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Add a source',
    label: 'Add a source',
    onClose: () => {},
    children: (
      <div className="form-grid">
        <label>
          Name
          <input defaultValue="Acme Platform" />
        </label>
        <label>
          Base URL
          <input defaultValue="https://github.com" />
        </label>
      </div>
    ),
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};

export const WithSubtitleAndFooter: Story = {
  args: {
    subtitle: 'Read-only. Nothing any connector calls writes anything.',
    footer: (
      <>
        <button className="btn">Cancel</button>
        <button className="btn primary">Save</button>
      </>
    ),
  },
};

/** Long enough to scroll: the case a portalled menu exists for. */
export const Scrolling: Story = {
  args: {
    children: (
      <div className="form-grid">
        {Array.from({ length: 14 }, (_, i) => (
          <label key={i}>
            {`Field ${i + 1}`}
            <input defaultValue="" />
          </label>
        ))}
      </div>
    ),
  },
};

/**
 * The other one: a question with two answers, where the destructive one is
 * named rather than called "OK".
 */
export const Confirm: StoryObj<typeof ConfirmDialog> = {
  render: () => (
    <ConfirmDialog
      title="Delete this source?"
      message="Its stored history and its archived changelogs go with it. This cannot be undone."
      confirmLabel="Delete the source"
      onConfirm={() => {}}
      onClose={() => {}}
    />
  ),
};
