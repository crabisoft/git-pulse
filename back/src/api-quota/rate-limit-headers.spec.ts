import { describe, expect, it } from 'vitest';
import { githubQuota, gitlabQuota } from './rate-limit-headers';

describe('githubQuota', () => {
  it('reads the counters and names the bucket the call was charged to', () => {
    const sample = githubQuota({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4712',
      'x-ratelimit-used': '288',
      'x-ratelimit-reset': '1774526400',
      'x-ratelimit-resource': 'core',
    });

    expect(sample).toEqual({
      bucket: 'core',
      limit: 5000,
      used: 288,
      resetAt: new Date(1774526400 * 1000),
      windowSec: 3600,
    });
  });

  it('meters search by the minute, not by the hour like core', () => {
    const headers = { 'x-ratelimit-limit': '30', 'x-ratelimit-reset': '1774526400' };

    expect(githubQuota({ ...headers, 'x-ratelimit-resource': 'search' })?.windowSec).toBe(60);
    expect(githubQuota({ ...headers, 'x-ratelimit-resource': 'core' })?.windowSec).toBe(3600);
  });

  it('leaves the window unknown for a bucket whose length is not documented', () => {
    const sample = githubQuota({
      'x-ratelimit-limit': '100',
      'x-ratelimit-reset': '1774526400',
      'x-ratelimit-resource': 'some_future_bucket',
    });

    expect(sample?.bucket).toBe('some_future_bucket');
    expect(sample?.windowSec).toBeNull();
  });

  it('derives the used count from what is left when the counter is absent', () => {
    const sample = githubQuota({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-reset': '1774526400',
    });

    expect(sample?.used).toBe(1000);
    // Enterprise instances predate the resource header; core is the only bucket
    // they meter, so assuming it beats dropping the reading.
    expect(sample?.bucket).toBe('core');
  });

  it('never reports a negative usage, whatever the pair of counters says', () => {
    const sample = githubQuota({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '80',
      'x-ratelimit-reset': '1774526400',
    });

    expect(sample?.used).toBe(0);
  });
});

describe('gitlabQuota', () => {
  it('reads the counters an instance sends when rate limiting is on', () => {
    const sample = gitlabQuota({
      'ratelimit-limit': '600',
      'ratelimit-observed': '42',
      'ratelimit-remaining': '558',
      'ratelimit-reset': '1774526460',
    });

    expect(sample).toEqual({
      bucket: 'rest',
      limit: 600,
      used: 42,
      resetAt: new Date(1774526460 * 1000),
      windowSec: 60,
    });
  });

  it('accepts a Headers instance, which is what a failed request carries', () => {
    const headers = new Headers({
      'RateLimit-Limit': '600',
      'RateLimit-Observed': '601',
      'RateLimit-Reset': '1774526460',
    });

    expect(gitlabQuota(headers)?.used).toBe(601);
  });
});

describe('a provider that meters nothing', () => {
  it('yields no sample rather than a zeroed one', () => {
    // A self-hosted GitLab with rate limiting disabled sends no counter at all.
    // Reporting 0/0 here would show a full budget where nothing was measured.
    expect(gitlabQuota({})).toBeNull();
    expect(githubQuota({ 'x-ratelimit-limit': '5000' })).toBeNull();
    expect(githubQuota({ 'x-ratelimit-limit': 'n/a', 'x-ratelimit-reset': '1' })).toBeNull();
  });
});
