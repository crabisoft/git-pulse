import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ApiQuotaPublic } from '@repo/shared';
import { QuotaGauge } from './QuotaGauge';

/**
 * What a source has spent of its platform's rate limit.
 *
 * Four readings that must not look alike, which is the whole reason this has
 * stories: a measured budget, a declared one, a window that has elapsed, and a
 * budget about to run out. The gauge takes `now` as a prop precisely so a
 * reading can be looked at at a chosen moment — here, so these pictures are
 * the same every time.
 */
const NOW = Date.UTC(2026, 6, 31, 10, 0, 0);

const QUOTA: ApiQuotaPublic = {
  subjectKind: 'source',
  subjectId: 'src-1',
  bucket: 'core',
  limit: 5000,
  used: 1240,
  remaining: 3760,
  resetAt: new Date(NOW + 42 * 60_000).toISOString(),
  windowSec: 3600,
  origin: 'observed',
  observedAt: new Date(NOW - 3 * 60_000).toISOString(),
};

const meta = {
  title: 'Controls/QuotaGauge',
  component: QuotaGauge,
  args: { quota: QUOTA, now: NOW },
} satisfies Meta<typeof QuotaGauge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Read from the platform's own headers — the common case. */
export const Measured: Story = {};

/** Past three quarters the bar warns, and past nine tenths it does not. */
export const NearlySpent: Story = {
  args: { quota: { ...QUOTA, used: 4820, remaining: 180 } },
};

export const Warning: Story = {
  args: { quota: { ...QUOTA, used: 4000, remaining: 1000 } },
};

/**
 * Counted here rather than measured, for an instance that meters nothing. It
 * is marked as such: a supposition must never read as a measurement.
 */
export const Declared: Story = {
  args: { quota: { ...QUOTA, origin: 'declared', bucket: 'rest', limit: 600, used: 210 } },
};

/**
 * The window closed and nothing has been called since. Drawn as expired rather
 * than as reset — the next window's counter is unknown until a call is made in
 * it, and showing a full budget would be inventing one.
 */
export const WindowElapsed: Story = {
  args: { quota: { ...QUOTA, resetAt: new Date(NOW - 5 * 60_000).toISOString() } },
};

/** GitHub meters search by the minute, on a budget two orders smaller. */
export const AnotherBucket: Story = {
  args: { quota: { ...QUOTA, bucket: 'search', limit: 30, used: 26, remaining: 4, windowSec: 60 } },
};
