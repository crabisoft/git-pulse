import { PrismaClient } from '@prisma/client';
import { prismaAdapter } from '../prisma/adapter';
import { hashPassword } from '../auth/password';

/**
 * Fills an install with a fictional organization, so the application can be
 * looked at before anybody has a GitHub or GitLab credential to give it.
 *
 * Evaluating a dashboard by first creating a GitHub App, granting it
 * repositories and waiting for a collection is a lot to ask of somebody who
 * only wants to see what the pages look like. This writes the store directly,
 * as a `stored` source — the one mode that needs no provider at all.
 *
 *   make demo                       # dev stack
 *   make demo mode=prod             # prod stack
 *   make demo-clear                 # remove it again
 *
 * Four properties it holds to:
 *
 * - **Anchored to now.** Everything is generated relative to the moment it
 *   runs, so the overview says "8 minutes ago" rather than "last spring".
 * - **Deterministic.** One seeded generator, no `Math.random`: two runs a month
 *   apart produce the same organization, which is what makes a screenshot
 *   reproducible and a bug report comparable.
 * - **Idempotent.** It owns one source, by slug, and rewrites it whole. Real
 *   sources on the same install are never touched.
 * - **Coherent.** The metric history is computed from the events it just
 *   generated, over the same trailing window the collection uses — so a chart
 *   and the value above it tell the same story rather than two.
 *
 * The generation is exported and tested (`seed-demo.spec.ts`); what is left
 * here is the writing.
 */

export const DEMO_SLUG = 'acme-platform';
const OWNER = 'acme';
const DAYS = 90;
/** The window the metrics are computed over, as `doraWindowDays` defaults to. */
const WINDOW = 30;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const DEMO_REPOS = [
  { name: `${OWNER}/checkout-service`, app: 'checkout', client: 'northwind' },
  { name: `${OWNER}/identity-provider`, app: 'identity', client: 'globex' },
  { name: `${OWNER}/billing-api`, app: 'billing', client: 'northwind' },
  { name: `${OWNER}/storefront-web`, app: 'storefront', client: 'initech' },
];

const SUBJECTS: Array<[string, string]> = [
  ['feat', 'accept passkeys as a second factor'],
  ['feat', 'let an order be split across two shipments'],
  ['fix', 'keep the cart when the session is renewed'],
  ['fix', 'stop retrying a payment the bank already refused'],
  ['fix', 'read the tax rate of the delivery country, not the billing one'],
  ['perf', 'batch the catalogue lookups behind one query'],
  ['refactor', 'move the pricing rules out of the controller'],
  ['docs', 'say what the webhook retries look like'],
  ['chore', 'raise the client timeout to what the gateway allows'],
  ['feat', 'expose the invoice as a signed PDF'],
];

const AUTHORS = ['dana.h', 'ilya.p', 'marta.c', 'noor.a', 'sven.k', 'tomas.r'];

/**
 * The classification the demo installs alongside its data.
 *
 * Both targets on purpose: an environment name carries the client, a repository
 * name does not, and `app` has to mean the same thing on both sides or the two
 * halves of the report would not join. Exported because the generator and these
 * patterns have to agree — which is asserted rather than assumed.
 */
export const DEMO_RULES = [
  {
    id: 'demo-environment',
    name: 'demo · environment',
    pattern: '^(?<env>prod|staging|review)(-\\d+)?-(?<client>[a-z]+)-(?<app>[a-z]+)$',
    kind: 'simple' as const,
    target: 'environment' as const,
    priority: 20,
  },
  {
    id: 'demo-repository',
    name: 'demo · repository',
    pattern: `^${OWNER}/(?<app>checkout|identity|billing|storefront)`,
    kind: 'simple' as const,
    target: 'repository' as const,
    priority: 20,
  },
  {
    id: 'demo-meta',
    name: 'Production',
    pattern: '^prod-',
    kind: 'meta' as const,
    target: 'environment' as const,
    priority: 10,
  },
];

export interface DemoDeployment {
  externalId: string;
  repo: string;
  environment: string;
  ref: string;
  status: string;
  at: number;
  client: string;
  app: string;
  env: string;
}

export interface DemoPullRequest {
  externalId: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  author: string;
  headRef: string;
  openedAt: number;
  mergedAt: number | null;
  firstCommitAt: number | null;
  firstReviewAt: number | null;
  reviewers: number;
  /** The deployment that carried it, resolved once both lists exist. */
  deployedAt: number | null;
}

export interface DemoSnapshot {
  metric: string;
  value: number;
  dimensions: Record<string, string>;
  capturedAt: number;
}

// A type alias rather than an interface, deliberately: Prisma's Json input
// wants an index signature, and only an alias gets an implicit one.
export type DemoEntry = {
  summary: string;
  message: string;
  scope: string;
  breaking: boolean;
  sha: string;
  author: string;
  url: string;
  tickets: never[];
  pullRequest: { number: number; url: string; title: string };
};

export interface DemoChangelog {
  deploymentId: string;
  repo: string;
  environment: string;
  ref: string;
  baseRef: string;
  refUrl: string;
  baseRefUrl: string;
  environmentUrl: string;
  status: string;
  entries: DemoEntry[];
  markdown: string;
  authors: number;
  commits: number;
  unreadable: boolean;
  deployedAt: number;
}

export interface DemoData {
  deployments: DemoDeployment[];
  pullRequests: DemoPullRequest[];
  snapshots: DemoSnapshot[];
  changelogs: DemoChangelog[];
}

/**
 * How the organization is doing on day `d`, oldest first — the shape the events
 * are drawn around. It improves over the quarter, because a demo whose every
 * metric is flat says nothing about what the trends are for.
 */
function targets(d: number) {
  const progress = d / DAYS;
  return {
    /** Coding time, seconds: two days down to eight hours. */
    coding: (2 * 24 - 16 * progress) * 3600,
    /** Pickup: half a day down to two hours. */
    pickup: (12 - 10 * progress) * 3600,
    /** Review: a day down to four hours. */
    review: (24 - 20 * progress) * 3600,
    /** Deployments a day, across the whole scope. */
    perDay: 1.6 + 2.6 * progress,
    /** Share of deployments that fail. */
    failure: 0.19 - 0.09 * progress,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A calendar version, the way a release branch is usually named. */
export function demoVersion(at: number): string {
  const date = new Date(at);
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `release/${date.getUTCFullYear()}.${month}.${day}`;
}

/** A stable fake sha, so a regenerated demo does not rewrite every link. */
function sha(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}

function markdown(entries: DemoEntry[]): string {
  if (entries.length === 0) return '';
  return ['## What changed', '', ...entries.map((e) => `- ${e.summary} (${e.sha.slice(0, 7)})`)].join(
    '\n',
  );
}

/**
 * The whole fictional history, as plain values.
 *
 * Pure and seeded: same `now`, same organization, down to the shas. The seed is
 * local to the call rather than to the module, or a second call would continue
 * the first one's sequence and quietly stop being reproducible.
 */
export function generateDemo(now: number): DemoData {
  let a = 20260801 >>> 0;
  const random = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const between = (min: number, max: number): number => min + random() * (max - min);
  const chance = (p: number): boolean => random() < p;

  // Anchored to midnight, not to the hour it happens to be run at: the events
  // of a day are drawn between 09:00 and 19:00, and from any other anchor the
  // late ones would spill into the next day — including into the weekend the
  // rhythm is supposed to leave empty.
  const start = Math.floor((now - DAYS * DAY) / DAY) * DAY;
  const deployments: DemoDeployment[] = [];
  const pullRequests: DemoPullRequest[] = [];
  let prNumber = 1120;
  let deployNumber = 4200;

  for (let d = 0; d < DAYS; d++) {
    const dayStart = start + d * DAY;
    const weekday = new Date(dayStart).getUTCDay();
    // Nothing ships at the weekend, which is what makes the 24-hour strip and
    // the frequency chart look like a team rather than a signal generator.
    if (weekday === 0 || weekday === 6) continue;
    const target = targets(d);

    for (const repo of DEMO_REPOS) {
      const merged = Math.round(between(0.4, 1.6));
      for (let i = 0; i < merged; i++) {
        const [type, subject] = pick(SUBJECTS);
        const coding = target.coding * between(0.5, 1.8) * 1000;
        const pickup = target.pickup * between(0.4, 2.2) * 1000;
        const review = target.review * between(0.5, 2.4) * 1000;
        const mergedAt = dayStart + between(8 * HOUR, 18 * HOUR);
        const number = prNumber++;
        pullRequests.push({
          externalId: `gh:${repo.name}:${number}`,
          repo: repo.name,
          number,
          title: `${type}(${repo.app}): ${subject}`,
          state: 'merged',
          author: pick(AUTHORS),
          headRef: `${type}/${subject.split(' ').slice(0, 3).join('-')}`,
          openedAt: mergedAt - review - pickup,
          mergedAt,
          firstCommitAt: mergedAt - review - pickup - coding,
          firstReviewAt: mergedAt - review,
          reviewers: Math.round(between(1, 3)),
          deployedAt: null,
        });
      }

      // Staging takes everything, production a share of it, and a review
      // environment appears now and then.
      const envs = [
        { env: 'staging', p: 0.8 },
        { env: 'prod', p: Math.min(0.9, target.perDay / 4) },
        { env: 'review', p: 0.25 },
      ];
      for (const { env, p } of envs) {
        if (!chance(p)) continue;
        const failed = chance(env === 'prod' ? target.failure * 0.6 : target.failure);
        const id = deployNumber++;
        // A handful of review environments rather than one per deployment: the
        // overview folds by name, and ninety single-use rows would bury the two
        // that matter.
        const suffix = env === 'review' ? `-${1281 + (id % 3)}` : '';
        deployments.push({
          externalId: `gh:${repo.name}:${id}`,
          repo: repo.name,
          environment: `${env}${suffix}-${repo.client}-${repo.app}`,
          ref:
            env === 'prod'
              ? demoVersion(dayStart)
              : env === 'staging'
                ? 'main'
                : 'feat/passkey-enrolment',
          status: failed ? 'failed' : 'success',
          at: dayStart + between(9 * HOUR, 19 * HOUR),
          client: repo.client,
          app: repo.app,
          env,
        });
      }
    }
  }

  deployments.sort((x, y) => x.at - y.at);

  // What carried what: the earliest successful deployment of the repo after the
  // merge, which is the correlation the metric itself makes.
  for (const pr of pullRequests) {
    if (pr.mergedAt === null) continue;
    const carrier = deployments.find(
      (dep) => dep.repo === pr.repo && dep.status === 'success' && dep.at > pr.mergedAt!,
    );
    pr.deployedAt = carrier ? carrier.at : null;
  }

  // Open pull requests, three of them past the staleness threshold: the
  // friction panel is a list of what nobody has got to yet.
  for (let i = 0; i < 14; i++) {
    const repo = pick(DEMO_REPOS);
    const [type, subject] = pick(SUBJECTS);
    const age = i < 3 ? between(5 * DAY, 26 * DAY) : between(2 * HOUR, 40 * HOUR);
    const number = prNumber++;
    pullRequests.push({
      externalId: `gh:${repo.name}:${number}`,
      repo: repo.name,
      number,
      title: `${type}(${repo.app}): ${subject}`,
      state: chance(0.15) ? 'draft' : 'open',
      author: pick(AUTHORS),
      headRef: `${type}/${subject.split(' ').slice(0, 3).join('-')}`,
      openedAt: now - age,
      mergedAt: null,
      firstCommitAt: now - age - between(1 * HOUR, 20 * HOUR),
      firstReviewAt: i < 3 ? null : chance(0.5) ? now - age + HOUR : null,
      reviewers: i < 3 ? 0 : Math.round(between(0, 2)),
      deployedAt: null,
    });
  }

  // ─── The metric history ─────────────────────────────────────────────
  // Computed from the events above, over the same trailing window the
  // scheduled collection uses. Written for the global combination and for two
  // slices, which is what makes the dimension filter change a chart.
  const combos: Array<Record<string, string>> = [
    {},
    { env: 'prod', client: 'northwind', app: 'checkout' },
    { env: 'prod', client: 'globex', app: 'identity' },
  ];
  const snapshots: DemoSnapshot[] = [];

  for (let d = WINDOW; d <= DAYS; d++) {
    const at = start + d * DAY;
    const from = at - WINDOW * DAY;
    for (const combo of combos) {
      const deps = deployments.filter(
        (dep) =>
          dep.at > from &&
          dep.at <= at &&
          (combo.env === undefined || dep.env === combo.env) &&
          (combo.client === undefined || dep.client === combo.client) &&
          (combo.app === undefined || dep.app === combo.app),
      );
      if (deps.length === 0) continue;
      const prs = pullRequests.filter(
        (pr) =>
          pr.deployedAt !== null &&
          pr.deployedAt > from &&
          pr.deployedAt <= at &&
          (combo.app === undefined || repoOf(combo.app) === pr.repo),
      );

      const failures = deps.filter((dep) => dep.status === 'failed');
      const restores: number[] = [];
      for (const failure of failures) {
        const next = deps.find(
          (dep) =>
            dep.environment === failure.environment && dep.status === 'success' && dep.at > failure.at,
        );
        if (next) restores.push((next.at - failure.at) / 1000);
      }
      const reviewed = prs.filter((pr) => pr.firstReviewAt !== null);

      const push = (metric: string, value: number | null): void => {
        if (value === null || !Number.isFinite(value)) return;
        snapshots.push({ metric, value, dimensions: combo, capturedAt: at });
      };

      // Per day, like the computation writes it — successes only, since a
      // failed deployment delivered nothing.
      push('deployment_frequency', deps.filter((dep) => dep.status === 'success').length / WINDOW);
      push('change_failure_rate', failures.length / deps.length);
      push('mttr', median(restores));
      push('lead_time', median(prs.map((pr) => (pr.deployedAt! - pr.firstCommitAt!) / 1000)));
      push('coding_time', median(prs.map((pr) => (pr.openedAt - pr.firstCommitAt!) / 1000)));
      push('pickup_time', median(reviewed.map((pr) => (pr.firstReviewAt! - pr.openedAt) / 1000)));
      push('review_time', median(reviewed.map((pr) => (pr.mergedAt! - pr.firstReviewAt!) / 1000)));
      push('deploy_time', median(prs.map((pr) => (pr.deployedAt! - pr.mergedAt!) / 1000)));
    }
  }

  // ─── The changelog archive ──────────────────────────────────────────
  // The last stretch of production deployments, filed as the collection would
  // have filed them — one of them without contents, which is the row a reader
  // has to be able to recognise.
  const production = deployments.filter((dep) => dep.env === 'prod' && dep.status === 'success');
  const changelogs: DemoChangelog[] = production.slice(-30).map((dep, i) => {
    const carried = pullRequests.filter((pr) => pr.repo === dep.repo && pr.deployedAt === dep.at);
    const entries: DemoEntry[] = carried.map((pr) => ({
      summary: pr.title.replace(/^[a-z]+\([a-z]+\): /, ''),
      message: pr.title,
      scope: dep.app,
      breaking: false,
      sha: sha(pr.externalId),
      author: pr.author,
      url: `https://github.com/${dep.repo}/commit/${sha(pr.externalId)}`,
      tickets: [],
      pullRequest: {
        number: pr.number,
        url: `https://github.com/${dep.repo}/pull/${pr.number}`,
        title: pr.title,
      },
    }));
    const unreadable = i === 6;
    const baseRef = demoVersion(dep.at - 3 * DAY);
    return {
      deploymentId: dep.externalId,
      repo: dep.repo,
      environment: dep.environment,
      ref: dep.ref,
      baseRef,
      refUrl: `https://github.com/${dep.repo}/tree/${dep.ref}`,
      baseRefUrl: `https://github.com/${dep.repo}/tree/${baseRef}`,
      environmentUrl: `https://${dep.app}.${dep.client}.example.com`,
      status: dep.status,
      entries: unreadable ? [] : entries,
      markdown: unreadable ? '' : markdown(entries),
      authors: unreadable ? 0 : new Set(entries.map((e) => e.author)).size,
      commits: unreadable ? 0 : entries.length,
      unreadable,
      deployedAt: dep.at,
    };
  });

  return { deployments, pullRequests, snapshots, changelogs };
}

/** `checkout` → the repository it belongs to, so a slice can filter requests. */
function repoOf(app: string): string {
  return DEMO_REPOS.find((repo) => repo.app === app)?.name ?? app;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: prismaAdapter() });
  const now = Date.now();

  try {
    // Leaving is as easy as arriving: the source cascades to everything this
    // wrote, and the rules go with it. The demo account stays — by then it may
    // be the one the install was configured with.
    if (process.argv[2] === '--clear') {
      const { count } = await prisma.source.deleteMany({ where: { slug: DEMO_SLUG } });
      await prisma.envRule.deleteMany({ where: { id: { startsWith: 'demo-' } } });
      console.log(count > 0 ? 'Demo source removed.' : 'No demo source to remove.');
      return;
    }

    const { deployments, pullRequests, snapshots, changelogs } = generateDemo(now);

    await prisma.source.deleteMany({ where: { slug: DEMO_SLUG } });
    const source = await prisma.source.create({
      data: {
        name: 'Acme Platform (demo)',
        slug: DEMO_SLUG,
        kind: 'github',
        baseUrl: 'https://github.com',
        authKind: 'token',
        scope: { owner: OWNER, include: [], exclude: [], trackNewRepos: true },
        mode: 'stored',
        webhooksEnabled: false,
        historyDays: DAYS,
        isDefault: true,
      },
    });

    // The rules that turn these names into dimensions. Both targets are used on
    // purpose: an environment name carries the client, a repository name does
    // not, and `app` has to mean the same thing on both sides or the two halves
    // of the report would not join.
    const rules = await Promise.all(
      DEMO_RULES.map(({ id, ...rule }) =>
        prisma.envRule.upsert({ where: { id }, update: rule, create: { id, ...rule } }),
      ),
    );
    await prisma.sourceEnvRule.createMany({
      data: rules.map((rule) => ({ sourceId: source.id, ruleId: rule.id })),
      skipDuplicates: true,
    });

    const seen = new Date(now - 8 * 60_000);

    await prisma.storedRepo.createMany({
      data: DEMO_REPOS.map((repo) => ({
        sourceId: source.id,
        name: repo.name,
        defaultBranch: 'main',
        seenAt: seen,
      })),
    });

    await prisma.storedPullRequest.createMany({
      data: pullRequests.map((pr) => ({
        sourceId: source.id,
        repo: pr.repo,
        externalId: pr.externalId,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.author,
        url: `https://github.com/${pr.repo}/pull/${pr.number}`,
        repoUrl: `https://github.com/${pr.repo}`,
        headRef: pr.headRef,
        openedAt: new Date(pr.openedAt),
        updatedAt: new Date(pr.mergedAt ?? pr.openedAt),
        mergedAt: pr.mergedAt === null ? null : new Date(pr.mergedAt),
        reviewers: pr.reviewers,
        firstCommitAt: pr.firstCommitAt === null ? null : new Date(pr.firstCommitAt),
        firstReviewAt: pr.firstReviewAt === null ? null : new Date(pr.firstReviewAt),
        seenAt: seen,
      })),
    });

    await prisma.storedDeployment.createMany({
      data: deployments.map((dep) => ({
        sourceId: source.id,
        repo: dep.repo,
        externalId: dep.externalId,
        environment: dep.environment,
        ref: dep.ref,
        status: dep.status,
        environmentUrl: dep.env === 'prod' ? `https://${dep.app}.${dep.client}.example.com` : null,
        url: `https://github.com/${dep.repo}/deployments/${dep.externalId.split(':').pop()}`,
        createdAt: new Date(dep.at),
        seenAt: seen,
      })),
    });

    // One run per deployment, the last two still going: what a dashboard shows
    // as running or failed is not only what deployed.
    await prisma.storedPipeline.createMany({
      data: deployments.map((dep, i) => ({
        sourceId: source.id,
        repo: dep.repo,
        externalId: `run:${dep.externalId}`,
        repoUrl: `https://github.com/${dep.repo}`,
        ref: dep.ref,
        status: i >= deployments.length - 2 ? 'running' : dep.status,
        url: `https://github.com/${dep.repo}/actions/runs/${1000 + i}`,
        createdAt: new Date(dep.at - 12 * 60_000),
        updatedAt: new Date(dep.at),
        durationSec: 120 + ((i * 37) % 780),
        seenAt: seen,
      })),
    });

    await prisma.metricSnapshot.createMany({
      data: snapshots.map((snapshot) => ({
        sourceId: source.id,
        metric: snapshot.metric,
        value: snapshot.value,
        dimensions: snapshot.dimensions,
        capturedAt: new Date(snapshot.capturedAt),
      })),
    });

    await prisma.deploymentChangelog.createMany({
      data: changelogs.map((log) => ({
        sourceId: source.id,
        deploymentId: log.deploymentId,
        repo: log.repo,
        environment: log.environment,
        ref: log.ref,
        baseRef: log.baseRef,
        base: 'previous',
        refUrl: log.refUrl,
        baseRefUrl: log.baseRefUrl,
        deploymentUrl: `https://github.com/${log.repo}/deployments`,
        environmentUrl: log.environmentUrl,
        status: log.status,
        entries: log.entries,
        markdown: log.markdown,
        authors: log.authors,
        commits: log.commits,
        unreadable: log.unreadable,
        generator: 'builtin',
        deployedAt: new Date(log.deployedAt),
        archivedAt: new Date(log.deployedAt + 20 * 60_000),
      })),
    });

    // Freshness: what the overview reads to say how old the view is.
    await prisma.syncState.createMany({
      data: (['repos', 'pulls', 'pipelines', 'deployments'] as const).map((resource) => ({
        sourceId: source.id,
        resource,
        cursor: new Date(now - DAYS * DAY),
        lastSyncAt: seen,
        lastFullSyncAt: new Date(now - 2 * HOUR),
      })),
    });

    // ─── Somebody to sign in as ───────────────────────────────────────
    // `||` rather than `??`: `make demo` with no argument passes empty strings
    // through the shell, and those are neither nullish nor addresses.
    const email = (process.argv[2] || 'demo@example.com').trim().toLowerCase();
    const password = process.argv[3] || 'demo-password';
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({
        data: { email, name: 'Demo admin', passwordHash: await hashPassword(password), role: 'admin' },
      });
    }

    console.log(`Demo data written to "${source.name}" (/${DEMO_SLUG}).`);
    console.log(
      `  ${DEMO_REPOS.length} repositories · ${deployments.length} deployments · ` +
        `${pullRequests.length} pull requests · ${snapshots.length} metric snapshots · ` +
        `${changelogs.length} archived changelogs`,
    );
    console.log(
      existing
        ? `  Sign in as ${email} — the account already existed, its password is unchanged.`
        : `  Sign in as ${email} / ${password}`,
    );
    console.log('  Re-run to regenerate it, `make demo-clear` to remove it.');
  } finally {
    await prisma.$disconnect();
  }
}

// Imported by its test, run by `make demo`. Nothing happens on import.
if (process.argv[1]?.includes('seed-demo')) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
