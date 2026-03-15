# Technical documentation

How Git Dashboard works, one subject per file. Written for whoever operates it
or changes it — the reasoning behind a behaviour is here, not only the
behaviour.

**Start with [Collection and metrics](collection-and-metrics.md).** It explains
what is written to the database and what is recomputed on every request, which
is the distinction every other document leans on.

## The shape of the thing

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | Stack, monorepo layout, and what each module owns |
| [Collection and metrics](collection-and-metrics.md) | Where data lives, when it is written, when a figure is computed |
| [The web application](frontend.md) | Routing, slugs, and how the UI paces expensive requests |
| [API conventions](api.md) | Pagination on list routes, and cancelling an abandoned request |
| [Accounts and access](authentication.md) | The four access levels, sessions, sign-in throttling, recovery |

## Reading a platform

| Document | What it covers |
|---|---|
| [Sources](sources.md) | Declaring a source, what to grant it, `live` versus `stored` |
| [The store and its feeds](ingestion.md) | What a stored source keeps, how listings and webhooks converge |
| [API quotas](api-quotas.md) | Metering, declared budgets, and giving up optional calls before the ceiling |

## What it computes

| Document | What it covers |
|---|---|
| [DORA metrics](dora.md) | Filters and periods, the lead-time breakdown, incidents, trends |
| [Deployments](deployments.md) | The deployment list, what each one carried, the changelog archive |
| [Release notes](release-notes.md) | Generating them from a commit range, and rewriting them with a model |
| [Classification rules](classification-rules.md) | The RegEx engine that turns a name into dimensions |
| [Ticket references](ticket-references.md) | Trackers, ticket rules, and the links they resolve to |

## Running and changing it

| Document | What it covers |
|---|---|
| [Running it](operations.md) | The Docker stacks, published images, background jobs, migrations |
| [The demo dataset](demo.md) | `make demo` — a fictional organization, no credential involved |
| [Tests](testing.md) | What the suites cover, and what they deliberately do not |

## When something is wrong

These documents explain how the thing works. The [runbooks](../runbooks/)
explain what to do about it — backups, upgrades, the master key, a collection
that has stopped, a budget that is spent, webhooks that never arrive, a database
that keeps growing.

Contributing to the project itself — setup, expectations, commit style — is
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).
