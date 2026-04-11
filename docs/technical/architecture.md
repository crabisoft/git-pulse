# Architecture

What the application is made of, and which module owns what. For where
data lives and when a figure is computed, read
[Collection and metrics](collection-and-metrics.md) first — it is the one
document that explains why a value and its chart can disagree.

## Stack

| Layer | Technology |
|--------|--------|
| Frontend | React + TypeScript (Vite) |
| Backend | NestJS (TypeScript) |
| Database | PostgreSQL (Prisma) |
| Jobs / cache | Redis (BullMQ) |
| Sources | one client per connector — Octokit, @gitbeaker |

**npm workspaces** monorepo: `back`, `front`, `packages/shared`.

## Modules

- **`SourceConnector`** — common interface: an implementation per platform
  normalizes PRs/MRs, pipelines and deployments into the shared types. Two ship
  today, `GitHubConnector` and `GitLabConnector`, and adding a third changes
  nothing else. Base URLs are configurable, so self-hosted and enterprise
  instances are the same case as the public ones.
- **`CryptoModule`** — secrets (tokens, model keys) encrypted at rest with
  AES-256-GCM. The master key is generated on first boot into a `0600` file, or
  supplied through `MASTER_KEY` (base64) for Kubernetes / a secret manager.
  `Credential` is keyed by **owner** (`source`, `llmProvider`, `versionRule`)
  rather than by relation, the way `ApiQuota` is: a foreign key points at one
  table, and a model key is not a special case of a Git token. The cost is that no cascade
  reaches it, so every owner drops its own secret when it is deleted.
- **`LlmModule`** — model providers, and the one completion this application
  asks of one. See [Release notes](release-notes.md).
- **`SourcesModule`** — source CRUD plus connection testing.
- **`VersionRulesModule`** — reads back what each environment is actually
  running, over HTTP, and files it beside the deployment that put it there. The
  one module that makes an outbound request to an address a user supplied, which
  is why its probe is the only place with an address allowlist. See
  [Installed versions](versions.md).
- **`DashboardModule`** — live aggregation per source.
- **`ApiQuotaModule`** — what each source has spent of its platform's rate
  limit, read from the responses themselves.
