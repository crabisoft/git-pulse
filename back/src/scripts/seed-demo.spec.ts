import { describe, expect, it } from 'vitest';
import { DEMO_REPOS, DEMO_RULES, generateDemo } from './seed-demo';

/**
 * The demo dataset is the first thing a stranger sees, and it is generated
 * rather than written down — so what is checked here is that it stays the same
 * organization from one run to the next, that it sits where it claims to in
 * time, and that the numbers it publishes as history are the ones its own
 * events add up to.
 *
 * The writing is not covered: it is a handful of `createMany` calls against a
 * schema the Prisma client already types.
 */

const NOW = Date.UTC(2026, 6, 31, 10, 0, 0);
const DAY = 24 * 3_600_000;
const WINDOW = 30;

describe('the demo dataset', () => {
  const data = generateDemo(NOW);

  it('is the same organization every run', () => {
    // Seeded per call rather than per module: a shared generator would make the
    // second call a different organization, and only the first screenshot
    // reproducible.
    expect(JSON.stringify(generateDemo(NOW))).toBe(JSON.stringify(data));
  });

  it('sits in the ninety days behind the moment it was generated', () => {
    const oldest = Math.min(...data.deployments.map((dep) => dep.at));
    const newest = Math.max(...data.deployments.map((dep) => dep.at));
    expect(oldest).toBeGreaterThan(NOW - 91 * DAY);
    expect(newest).toBeLessThanOrEqual(NOW);
    // A weekday rhythm rather than a flat one — nothing ships on a Sunday.
    const weekend = data.deployments.filter((dep) => [0, 6].includes(new Date(dep.at).getUTCDay()));
    expect(weekend).toHaveLength(0);
  });

  it('leaves open pull requests, three of them stale', () => {
    const open = data.pullRequests.filter((pr) => pr.mergedAt === null);
    expect(open).toHaveLength(14);
    const stale = open.filter((pr) => NOW - pr.openedAt > 72 * 3_600_000);
    expect(stale.length).toBeGreaterThanOrEqual(3);
    // A stale one is stale because nobody looked at it, not because it is old.
    expect(stale.every((pr) => pr.firstReviewAt === null)).toBe(true);
  });

  it('names environments the way its own rules read them', () => {
    // The generator and the classification are written apart and have to agree:
    // a name the rule cannot read is a dimension the demo never shows.
    const rule = new RegExp(DEMO_RULES[0].pattern);
    for (const dep of data.deployments) {
      const match = rule.exec(dep.environment);
      expect(match, dep.environment).not.toBeNull();
      expect(match!.groups).toMatchObject({ env: dep.env, client: dep.client, app: dep.app });
    }
    const repoRule = new RegExp(DEMO_RULES[1].pattern);
    for (const repo of DEMO_REPOS) {
      expect(repoRule.exec(repo.name)?.groups?.app).toBe(repo.app);
    }
  });

  it('publishes a history its own events add up to', () => {
    const latest = Math.max(...data.snapshots.map((s) => s.capturedAt));
    const global = data.snapshots.filter(
      (s) => s.capturedAt === latest && Object.keys(s.dimensions).length === 0,
    );
    expect(global.map((s) => s.metric).sort()).toEqual([
      'change_failure_rate',
      'coding_time',
      'deploy_time',
      'deployment_frequency',
      'lead_time',
      'mttr',
      'pickup_time',
      'review_time',
    ]);

    // Counted again here rather than trusted: this is the arithmetic that makes
    // the chart and the value above it agree.
    const inWindow = data.deployments.filter(
      (dep) => dep.at > latest - WINDOW * DAY && dep.at <= latest,
    );
    const frequency = global.find((s) => s.metric === 'deployment_frequency');
    const delivered = inWindow.filter((dep) => dep.status === 'success').length;
    expect(frequency?.value).toBeCloseTo(delivered / WINDOW, 10);

    const failed = inWindow.filter((dep) => dep.status === 'failed').length;
    const rate = global.find((s) => s.metric === 'change_failure_rate');
    expect(rate?.value).toBeCloseTo(failed / inWindow.length, 10);
  });

  it('states no value it cannot mean', () => {
    for (const snapshot of data.snapshots) {
      expect(Number.isFinite(snapshot.value), snapshot.metric).toBe(true);
      expect(snapshot.value, snapshot.metric).toBeGreaterThanOrEqual(0);
      if (snapshot.metric === 'change_failure_rate') expect(snapshot.value).toBeLessThanOrEqual(1);
    }
    // Sliced series too, or filtering on a dimension would empty the chart.
    const sliced = data.snapshots.filter((s) => s.dimensions.app === 'checkout');
    expect(sliced.length).toBeGreaterThan(0);
  });

  it('files an archive, one record of it unreadable', () => {
    expect(data.changelogs).toHaveLength(30);
    const unreadable = data.changelogs.filter((log) => log.unreadable);
    expect(unreadable).toHaveLength(1);
    // Filed without contents means exactly that — not "carried nothing".
    expect(unreadable[0].commits).toBe(0);
    expect(unreadable[0].markdown).toBe('');
    for (const log of data.changelogs.filter((l) => !l.unreadable)) {
      expect(log.commits).toBe(log.entries.length);
      expect(log.authors).toBeLessThanOrEqual(log.commits);
    }
  });
});
