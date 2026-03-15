# Git Dashboard

**Self-hosted monitoring for Git platforms.** Live pull requests and pipelines,
DORA metrics with their history, deployment changelogs kept before the platform
forgets them, and release notes generated from a commit range — over GitHub and
GitLab, public or self-hosted.

Adding a platform means adding a connector: nothing in the data model, the UI or
the metric names mentions one.

![The overview: every environment with what is running on it, the four DORA
metrics with their trend, and the deployments of the last 24
hours](docs/images/overview.png)

<details>
<summary><b>More screenshots</b> — DORA metrics, a metric's trend, deployments, the changelog archive</summary>

<br>

**DORA metrics**, over the period and the dimensions the filter bar asks for.

![The DORA page: the four metrics plus the lead-time breakdown, each with a
sparkline](docs/images/dora.png)

**One metric**: how it moved, then the events it is made of.

![The lead time page: a chart of the historised snapshots, and the pull
requests behind the value](docs/images/dora-metric.png)

**Deployments**, filtered by period, repository, environment, status and
dimensions.

![The deployments page: a row per deployment with its environment, ref and
status](docs/images/deployments.png)

**The changelog archive**: what each deployment carried, filed while the
platform could still say.

![The changelogs page: archived deployments with their commit and author
counts](docs/images/changelogs.png)

</details>

## What it does

- **DORA metrics** — deployment frequency, lead time for changes, change
  failure rate, MTTR. Lead time is broken down into coding, pickup, review and
  deploy time. Every metric can be sliced by dimensions extracted from your own
  naming conventions.
- **A live view** per source — open pull requests, stale ones, pipeline runs,
  environments.
- **Deployments** — what went where, and the commits each deployment carried,
  compared against the previous one, the default branch, or any ref you name.
- **A changelog archive** — what a deployment carried, written down while the
  platform can still answer, so September can still tell you about March.
- **Release notes** — a commit range read as Conventional Commits, squashes
  expanded into the work they replaced, ticket links resolved, and an optional
  rewrite through a model provider you declare (Anthropic, OpenAI, Google,
  Mistral).
- **Incidents** — failures tied to the deployment that caused them, through the
  tickets both mention.
- **Quota-aware collection** — platform rate limits read from the responses
  themselves, budgets declared for instances that meter nothing, and optional
  calls given up before the ceiling rather than at it.
- **Two read modes** — call the provider on every request, or read a store the
  collection keeps current, with webhooks when your network allows them.

Everything the connectors do is **read-only**.

## Run it

One file, published images, no clone and no build:

```bash
curl -O https://raw.githubusercontent.com/CrabiSoft/git-dashboard/main/.docker/docker-compose.ghcr.yml
docker compose -f docker-compose.ghcr.yml up -d
```

The app is on <http://localhost:8080>, API included — one origin, one port. The
database migrations run before the API starts. Then:

1. Open it and **create the first admin account**. The bootstrap closes as soon
   as one exists.
2. Go to **Settings › Sources** and add a source: platform, base URL,
   organization or group, and a credential. It is encrypted immediately.
3. **Test** the connection, then **Collect now**.

> ⚠️ The master key encrypts every stored credential. It is generated on first
> boot into the `master-key` volume — **back it up separately**. Losing it makes
> every stored secret unrecoverable.

**Just looking?** `make demo` fills a local install with a fictional
organization — metrics, deployments and changelogs to click through, with no
GitHub or GitLab account involved. See [the demo dataset](docs/technical/demo.md).

## Work on it

Requires Docker and Node 24+.

```bash
git clone https://github.com/CrabiSoft/git-dashboard.git
cd git-dashboard
make dev
```

- Web: <http://localhost:5173> (Vite, hot reload)
- API: <http://localhost:3001/api> (NestJS, watch mode)

`make prod` builds the images locally and serves the app through nginx on
<http://localhost:8080>. Run `make` with no argument for the full list of
targets, and read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull
request.

## Configuration

Ports, database credentials and origins come from `.docker/.env`; override them
in `.docker/.env.local` (git-ignored) rather than editing the versioned file.
`.env.example` documents the variables a non-Docker run needs.

Everything else — collection schedule, DORA window, page size, API reserve,
public access — lives in the database and is edited from **Settings**.

## Documentation

Everything is under **[`docs/`](docs/)** — [`technical/`](docs/technical/) for
how it works, [`runbooks/`](docs/runbooks/) for what to do when something is
wrong. Start with [Collection and metrics](docs/technical/collection-and-metrics.md):
it explains what is stored and what is recomputed on every request, which is
what makes the rest make sense.

| | |
|---|---|
| [Architecture](docs/technical/architecture.md) | Stack, modules, and what each owns |
| [Sources](docs/technical/sources.md) | Declaring one, what to grant it, `live` versus `stored` |
| [DORA metrics](docs/technical/dora.md) | Filters, periods, lead time, incidents, trends |
| [Deployments](docs/technical/deployments.md) | What each deployment carried, and the archive |
| [Release notes](docs/technical/release-notes.md) | Commit ranges, squashes, model rewriting |
| [Running it](docs/technical/operations.md) | Docker stacks, background jobs, migrations |
| [Runbooks](docs/runbooks/) | Backups, upgrades, the master key, and what to do when collection stops |

## Stack

React + TypeScript (Vite) · NestJS · PostgreSQL (Prisma) · Redis (BullMQ) ·
Octokit and @gitbeaker behind a common connector interface. One npm workspaces
monorepo: `back`, `front`, `packages/shared`.

## Roadmap

Shipped:

- Foundation, connectors, encryption, live dashboard.
- Historization + DORA (4 metrics + lead time breakdown), RegEx environment
  engine (meta-env, priority + accumulation), BullMQ jobs.
- Trackers, ticket references, incidents, and failures tied to the change that
  caused them.
- Deployments view: filtered by period, repo, environment, status and
  dimensions, with what each deployment carried against either base.
- Accounts, roles and sign-in.
- API quotas: metering read from the platforms' rate-limit headers, declared
  budgets for the instances that meter nothing, and optional work given up
  before the ceiling.
- Release notes tag→tag, as Markdown, and their AI rewriting through a declared
  model provider (Anthropic, OpenAI, Google, Mistral).

Planned:

- Publishing the release notes back as a platform release.
- Review/CI/throughput metrics, alerts and thresholds.

## Contributing

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — getting it running, what a change is
  expected to carry, where things live.
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability, and the two
  deployment settings that are the operator's responsibility.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.

`make typecheck` and `make test` are what CI runs, alongside a build of the two
production images.

## License

Copyright © 2026 CrabiSoft.

Licensed under the **GNU Affero General Public License, version 3** — see
[`LICENSE`](LICENSE).

In practice: use it, deploy it, modify it freely. If you modify it *and* let
others reach it over a network, those users are entitled to your modified
source. Running it unmodified inside your own organization carries no such
obligation.
