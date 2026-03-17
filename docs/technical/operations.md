# Running it

The stacks, the jobs behind them, and the schema they run against.

## Everyday commands

A `Makefile` groups the day-to-day tasks — run `make` (no argument) for the
full self-documented list:

| Command | Effect |
|---|---|
| `make dev` | Dev stack (db + redis + API watch + Vite HMR) |
| `make logs` | Follow the logs |
| `make migrate name=x` | Create a migration |
| `make deploy` | Apply pending migrations |
| `make prod` | Prod stack (build + nginx) |
| `make test` | Unit tests of the pure engines |
| `make storybook` | Component catalogue, on `:6006` (dev stack up) |
| `make build` | Full monorepo build |
| `make clean` | Clean build artifacts |

Targets delegate to the npm scripts and the Docker wrapper described below.

## Docker

All the Docker configuration lives in `.docker/`:

```
.docker/
  docker-compose.yml       # base: db + redis
  docker-compose.dev.yml   # DEV override: watch / HMR, code mounted as a volume
  docker-compose.prod.yml  # PROD override: built images + nginx
  docker-compose.ghcr.yml  # standalone: the published images, nothing built
  Dockerfile.back · Dockerfile.front · nginx.conf
  .env                     # versioned defaults (no real secrets)
  .env.local               # your local overrides (git-ignored)
  .env.local.example       # template to copy
  compose.sh               # wrapper: mode + .env/.env.local chaining
```

### The published images

`.github/workflows/publish.yml` pushes two images to the GitHub registry on
every push to `main`, and again with a version on every `v*` tag:

| Image | Holds |
|---|---|
| `ghcr.io/<owner>/git-dashboard/api` | the compiled API; applies the migrations, then starts |
| `ghcr.io/<owner>/git-dashboard/web` | the built bundle behind nginx, which also proxies `/api` |

`docker-compose.ghcr.yml` is what runs them, and it is deliberately
**standalone**: it chains no override and reads none of the repository's `.env`
files, because it is meant to be downloaded on its own by somebody who never
cloned anything.

That stack publishes **one port**. The bundle in the web image is built with no
`VITE_API_URL`, so it calls `/api` on whatever origin served it, and nginx
proxies that to the API container — which is the only reason a single published
image can run on any host. Baking an address in at build time would produce an
image that works on exactly one deployment.

The API is therefore behind a proxy in that stack, and `TRUST_PROXY` is set to
`1` accordingly: without it every sign-in attempt would be counted against
nginx rather than against the caller, and the throttle would lock everybody out
together.

Images are amd64 only. Building arm64 on the hosted runners means emulating it,
which turns a three-minute install into a thirty-minute one; the workflow says
where to add the platform when that stops being true.

**Dev mode (recommended day to day)** — hot reload: `nest start --watch` on the
API, the Vite server (HMR) on the front. Source code is mounted as a volume, no
image rebuild on every change.

```bash
npm run docker:dev         # db + redis + API (watch) + front (Vite/HMR)
# Front: http://localhost:5173   ·   API: http://localhost:3001/api
npm run docker:logs        # followed logs
npm run docker:dev:down    # stop
```

> First run: the dev containers execute `npm install` into a dedicated
> `node_modules` volume (Alpine binaries) — expect a minute the first time,
> instant afterwards.

**Nothing the containers write lands in the working tree.** The root
`node_modules`, the per-package ones, the build outputs and the caches are all
named volumes, because these containers run as root and everything they leave
behind in a bind mount is a root-owned file the host user then cannot touch —
which surfaces later as a tool run from the host failing with `EACCES` on a
path that looks perfectly ordinary.

The catalogue runs in the front container for the same reason, and its port is
published alongside the dev server's:

```bash
make dev
make storybook             # http://localhost:6006 · STORYBOOK_PORT moves it
```

**Prod mode (validating a build)** — compiled API + static front served by nginx.

```bash
npm run docker:prod        # builds the images + starts
# Web: http://localhost:8080   ·   API: http://localhost:3001/api
npm run docker:prod:down   # stop
```

**Customizing the environment** — do not edit `.docker/.env` (versioned): copy
the template and override only what concerns you.

```bash
cp .docker/.env.local.example .docker/.env.local
# edit .docker/.env.local — e.g. WEB_PORT=9090, API_PORT=3100
npm run docker:up
```

`.env.local` overrides `.env` at startup (the `compose.sh` wrapper chains both
`--env-file`). Available variables: host ports, Postgres credentials,
`WEB_ORIGIN`, `VITE_API_URL`, images…

> ⚠️ **Master key**: persisted in the `master-key` volume. Losing it makes every
> stored secret unrecoverable — back it up separately.

## Without Docker

Prerequisites: Node 24+, a reachable PostgreSQL and Redis (see `.env`). The
Docker stacks and the local floor both track the active LTS, Node 24.

```bash
npm install
npm run build:shared
npm run db:deploy                        # applies the migrations
npm run dev:back                         # http://localhost:3001
npm run dev:front                        # http://localhost:5173
```

## Background jobs

Two BullMQ queues, one Redis. `collection` carries the repeatable `collect-all`
— registered on `collectCron` and re-registered whenever the setting changes —
and the `collect-source` jobs it fans out. `ingest` carries what webhook
deliveries ask to be written. Kept apart so a burst of events never queues
behind a synchronisation that takes minutes.

**Settings › Background jobs** reads them back: counts per queue, when the
schedule next fires, and the failures with the payload they were working on and
the message the platform answered with. A job can be retried or discarded from
there. It polls every few seconds — none of it is stored, it is a reading of
Redis at the instant.

> The one state worth watching for is **Redis not answering**. The API keeps
> serving stored data perfectly well while nothing at all is being collected
> behind it, and the page says so where every other screen would look normal.

**Retention is bounded on both ends** (`common/job-options`): the last 200
completed and 500 failed jobs per queue. Deeper on failures because a success is
a count and a failure is something somebody has to read. One-shot jobs get three
attempts with an exponential backoff — what makes them fail is a platform being
unreachable or a rate limit being hit, and neither clears in a second. The
repeatable gets none: the cron brings it back on its own, and a second attempt
would enqueue the whole fan-out twice.

**Completed with warnings** is its own list. A collection catches its
best-effort steps — the ingestion, the DORA snapshot — so a failure still
snapshots what is stored rather than leaving a hole in the series. That
completes the job green over a source that has stopped moving, so what it gave
up on travels in the job's return value and is listed apart. Nothing to retry:
the next run tries again.

## Database migrations

The schema is managed through **versioned migrations** (Prisma), committed to
`back/prisma/migrations/` and bundled into the prod image.

**Applying migrations** — automatic when the containers start:
`prisma migrate deploy` runs before the API, in **dev** as in **prod**
(non-interactive, idempotent). Locally without Docker: `npm run db:deploy`.

**Creating a migration** — after editing `back/prisma/schema.prisma`:

```bash
# dev database reachable on localhost:5432 (npm run docker:dev running)
npm run db:migrate -- --name add_table_x
# → generates back/prisma/migrations/<timestamp>_add_table_x/  → to commit
```

> `db:migrate` (= `prisma migrate dev`) creates the SQL file, applies it to the
> dev database and regenerates the client. In a team, migration files are the
> source of truth: commit them.

Other commands: `npm run db:deploy` (apply), `npm run db:studio` (Prisma data
browser).

**Rewritten migrations** — nothing is released yet, so a migration is amended
in place rather than superseded by a corrective one. A dev database that already
applied the previous version is then ahead of the files in two ways: its schema
differs, and `_prisma_migrations` holds the old checksum, which makes
`migrate deploy` refuse before it looks at anything else.

Catch-up SQL goes under `back/prisma/manual/`, **git-ignored**: such a script is
written for one developer's database state and would be replayed as part of the
chain by nobody. Run it by hand (`make psql`, then `\i <file>`).

It only covers the schema — re-recording an amended migration is left to
`prisma migrate resolve --applied <name>`, which records it with the checksum
Prisma computes itself instead of one written down by hand. `make db-reset`
remains the alternative whenever the database holds nothing worth keeping.
