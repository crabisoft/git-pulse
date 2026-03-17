import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';

/**
 * The one library component in the application, and the reason it needs
 * looking at: react-select in `unstyled` mode, wearing the app's own CSS.
 * What it buys is behaviour — keyboard, ARIA, type-to-filter, a menu that
 * escapes its container. What it must never bring is a second visual language
 * into the forms, and that is what a glance at this story checks.
 *
 * Open the menu: select-all and clear live at the top of it, because a
 * catalogue of dozens is the normal case here.
 */
const REPOS: MultiSelectOption[] = [
  { value: 'acme/checkout-service', label: 'acme/checkout-service', hint: 'private' },
  { value: 'acme/identity-provider', label: 'acme/identity-provider', hint: 'private' },
  { value: 'acme/billing-api', label: 'acme/billing-api', hint: 'internal' },
  { value: 'acme/storefront-web', label: 'acme/storefront-web', hint: 'public' },
  { value: 'acme/notifications-worker', label: 'acme/notifications-worker', hint: 'private' },
  { value: 'acme/infra-terraform', label: 'acme/infra-terraform', hint: 'private' },
];

function Stateful({
  initial = [],
  ...props
}: {
  initial?: string[];
  emptyLabel: string;
  disabled?: boolean;
  block?: boolean;
}) {
  const [selected, setSelected] = useState(new Set(initial));
  return (
    <div style={{ minHeight: '18rem' }}>
      <MultiSelect options={REPOS} selected={selected} onChange={setSelected} {...props} />
    </div>
  );
}

const meta = {
  title: 'Controls/MultiSelect',
  component: Stateful,
  args: { emptyLabel: 'All repositories' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Stateful>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Nothing selected. What that *means* is the caller's to say — on a filter bar
 * it reads as "no restriction", in a source form as "none applies" — hence the
 * label rather than a wording baked into the component.
 */
export const NoRestriction: Story = {};

export const SomeSelected: Story = {
  args: { initial: ['acme/checkout-service', 'acme/billing-api'] },
};

/** Enough chips to wrap, which is where the control either holds or does not. */
export const ManySelected: Story = {
  args: { initial: REPOS.map((repo) => repo.value) },
};

/** Filling its container, for a form field rather than a filter bar. */
export const Block: Story = {
  args: { block: true, initial: ['acme/identity-provider'], emptyLabel: 'None applies' },
};

export const Disabled: Story = {
  args: { disabled: true, initial: ['acme/checkout-service'] },
};
