# Contributing

Thanks for taking the time. This file covers what you need to get the project
running, what is expected of a change, and where things live.

By contributing, you agree that your contribution is licensed under the
[GNU AGPL-3.0](LICENSE), like the rest of the project. There is no CLA.

## Getting it running

Prerequisites: **Node 24+** and Docker. The Docker stack and the local floor
both track the active LTS.

```bash
make dev      # db + redis + API (watch) + front (Vite HMR)
make logs     # follow them
make dev-down # stop
```

Front on <http://localhost:5173>, API on <http://localhost:3001/api>. The first
run installs dependencies into a container volume — expect a minute.

Running without Docker is possible if you already have PostgreSQL and Redis;
see [*Without Docker*](docs/technical/operations.md#without-docker).

You do **not** need a real GitHub or GitLab instance to work on most of the
codebase: the metric engines, the classifiers and the front are covered by unit
tests that touch neither the network nor a database.

## Before you open a pull request

```bash
make typecheck   # the whole monorepo
make test        # 700+ unit tests, back and front
```

Both must pass. They are also what CI runs, plus a build of the two production
images.

The Playwright layout suite (`npm run test:layout -w @repo/front`) is **not** in
CI: it needs browsers and a running stack. Run it locally when you change
layout, spacing, or a shared control.

The screenshots in the README are generated from the same fixtures — no
database, no credential, no cropping by hand:

```bash
npm run screenshots -w @repo/front   # rewrites docs/images/*.png
```

Regenerate them when a change alters what those pages look like, and commit the
images with it.

If your change touches `back/prisma/schema.prisma`, include the generated
migration:

```bash
make migrate name=add_something
```

## What a good change looks like

- **One concern per pull request.** A refactor and a feature in the same diff
  are two pull requests.
- **Tests with behaviour.** New metric logic, a new classification rule, a new
  connector method: cover it. Bug fixes get a test that fails before the fix.
- **English for code, comments, and commit messages.** Some design documents
  under `docs/` are still in French; new ones may be in either language.
- **Comments that earn their place.** Explain why something is done this way,
  not what the line already says.
- **Conventional Commits**, scoped and short:

  ```
  feat(dora): weight lead time by deployment size
  fix(gitlab): keep paginating past an empty page
  docs(readme): split the metric section out
  ```

  The pull request title follows the same rule — it becomes the squash commit.

## Where things live

| Path | What it holds |
|---|---|
| `back/src/collection/` | the periodic collector and its jobs |
| `back/src/ingest/` | readers, webhook ingestion, the `live`/`stored` split |
| `back/src/dora/` | the DORA engines — pure functions, heavily tested |
| `back/src/env-rules/` | environment classification from a branch or job name |
| `back/src/sources/connectors/` | one file per platform, behind a shared interface |
| `front/src/pages/` | one file per screen |
| `packages/shared/` | types shared by both sides |
| `docs/technical/` | the technical documentation, one subject per file |

Read [Collection and metrics](docs/technical/collection-and-metrics.md) before
touching anything that stores or computes a metric — it explains what is written
to the database and what is recomputed on every request. Getting that
distinction wrong is the easiest way to introduce a wrong number.

## Adding a platform connector

Nothing in the data model, the UI, or the metric names is tied to GitHub or
GitLab. A new platform means implementing `SourceConnector`
(`back/src/sources/connectors/source-connector.interface.ts`) and registering
it. If you plan one, open an issue first — the interface may need to move
slightly to fit, and that is better discussed before the code.

## Reporting things

- **Bugs and ideas**: open an issue; the templates ask for what is actually
  needed to reproduce.
- **Security flaws**: do not open an issue. Follow [SECURITY.md](SECURITY.md).

Never paste a token, a private key, or the contents of `master.key` into an
issue. Redact them.
