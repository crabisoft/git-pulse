import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiQuotaPublic } from '@repo/shared';
import { QuotaGauge } from './QuotaGauge';

const NOW = new Date('2026-07-26T12:00:00Z').getTime();

function quota(over: Partial<ApiQuotaPublic> = {}): ApiQuotaPublic {
  return {
    subjectKind: 'source',
    subjectId: 'src-1',
    bucket: 'core',
    limit: 5000,
    used: 1250,
    remaining: 3750,
    resetAt: new Date(NOW + 20 * 60_000).toISOString(),
    windowSec: 3600,
    origin: 'observed',
    observedAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  };
}

describe('QuotaGauge', () => {
  it('reports the share consumed, not the share left', () => {
    render(<QuotaGauge quota={quota()} now={NOW} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('1,250 / 5,000')).toBeInTheDocument();
  });

  it('escalates as the budget runs out', () => {
    const level = (used: number) => {
      const { container, unmount } = render(<QuotaGauge quota={quota({ used })} now={NOW} />);
      const className = container.querySelector('.quota-bar')?.className ?? '';
      unmount();
      return className;
    };

    expect(level(1250)).toContain('ok');
    expect(level(3800)).toContain('warning');
    expect(level(4600)).toContain('critical');
  });

  it('marks a reading whose window is over instead of assuming a fresh budget', () => {
    // The new window's counter is unknown until a call is made in it: showing
    // 0 % here would invent a measurement.
    const past = new Date(NOW - 60_000).toISOString();
    const { container } = render(<QuotaGauge quota={quota({ resetAt: past })} now={NOW} />);

    expect(screen.getByText('sources.quota.elapsed')).toBeInTheDocument();
    expect(container.querySelector('.quota-bar')?.className).toContain('idle');
  });

  it('flags a declared ceiling so it never reads as a measured one', () => {
    render(<QuotaGauge quota={quota({ origin: 'declared' })} now={NOW} />);
    expect(screen.getByText('sources.quota.declared')).toBeInTheDocument();

    render(<QuotaGauge quota={quota()} now={NOW} />);
    expect(screen.queryAllByText('sources.quota.declared')).toHaveLength(1);
  });

  it('counts the delay to the reset in whole minutes', () => {
    render(<QuotaGauge quota={quota()} now={NOW} />);
    expect(screen.getByText(/"delay":"20min"/)).toBeInTheDocument();
  });
});
