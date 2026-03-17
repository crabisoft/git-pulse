import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReleaseNoteEntry } from '@repo/shared';
import { CommitList } from './CommitList';

/**
 * What a deployment carried, and what a release note is made of — the same
 * reading of a commit in both places.
 *
 * The entries here are the shapes that are easy to get wrong: a breaking
 * change, a message with a body nobody sees until it is unfolded, a commit
 * whose ticket resolved to no URL, and one that followed no convention.
 */
const entry = (over: Partial<ReleaseNoteEntry>): ReleaseNoteEntry => ({
  summary: 'keep the cart when the session is renewed',
  message: 'fix(checkout): keep the cart when the session is renewed',
  scope: 'checkout',
  breaking: false,
  sha: '9f2c41a8b0d6e7431f5c2a9b8e0d4c6a71b3e5f2',
  author: 'marta.c',
  url: 'https://github.com/acme/checkout-service/commit/9f2c41a',
  tickets: [],
  pullRequest: { number: 1284, url: 'https://github.com/acme/checkout-service/pull/1284' },
  ...over,
});

const ENTRIES: ReleaseNoteEntry[] = [
  entry({
    breaking: true,
    summary: 'the deployment payload names its environment URL',
    message:
      'feat(api)!: the deployment payload names its environment URL\n\n' +
      'BREAKING CHANGE: clients reading `environment` alone now receive null\n' +
      'where the platform states no address.',
    scope: 'api',
    tickets: [
      {
        key: 'OPS-402',
        url: 'https://tracker.example.com/browse/OPS-402',
        foundIn: 'title',
        tracker: { id: 'trk-1', name: 'Ops', kind: 'jira' },
      },
    ],
  }),
  entry({}),
  entry({
    summary: 'batch the catalogue lookups behind one query',
    message: 'perf(checkout): batch the catalogue lookups behind one query',
    author: 'ilya.p',
    sha: '3ab77e19c4d5f6072b8a1c0d9e3f5a7b2c4d6e80',
    // A ticket the rules found and no template could turn into a URL: the
    // reference travels without one rather than with a hole in it.
    tickets: [
      { key: 'SUP-118', foundIn: 'branch', tracker: { id: 'trk-1', name: 'Ops', kind: 'jira' } },
    ],
  }),
  entry({
    summary: 'Merge branch main into release',
    message: 'Merge branch main into release',
    scope: null,
    author: 'dana.h',
    sha: 'c0ffee1234567890abcdef1234567890abcdef12',
    pullRequest: null,
  }),
];

const meta = {
  title: 'Controls/CommitList',
  component: CommitList,
  args: { entries: ENTRIES },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CommitList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ARange: Story = {};

export const OneCommit: Story = { args: { entries: [ENTRIES[1]] } };

/**
 * A deployment that carried nothing against its base — the branch was already
 * merged, or the ref is the one it was compared against.
 */
export const Empty: Story = { args: { entries: [] } };
