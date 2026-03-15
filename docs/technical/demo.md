# The demo dataset

A fictional organization, written straight into the store, so the application
can be looked at before anybody has a credential to give it.

```bash
make demo                      # dev stack
make demo mode=prod            # prod stack
make demo-clear                # remove it again
```

It prints the account to sign in with — `demo@example.com` / `demo-password`
unless `make demo email=… password=…` says otherwise — and the source appears
as **Acme Platform (demo)** at `/dashboard/acme-platform`.

## Why it exists

Evaluating a dashboard should not start with creating a GitHub App, granting it
repositories and waiting for a collection to finish. The demo skips all of it:
the source is written in `stored` mode, which reads the database and never calls
a provider, so there is nothing to authenticate and nothing to rate-limit.

Everything it writes is what an ingestion would have written — the same four
tables, the same shapes. The pages do not know the difference, which is the
point: what you see is the real application, on invented data.

## What it contains

| | |
|---|---|
| Repositories | four, under the `acme` owner |
| Environments | `prod-`, `staging-` and three `review-` environments per client and app |
| History | 90 days, weekdays only |
| Deployments | ~460, roughly one in ten failed |
| Pull requests | ~250 merged with their lead-time segments, plus 14 open — three of them stale |
| Metric snapshots | daily, for the global combination and two slices |
| Changelogs | the last 30 production deployments, one of them filed unreadable |

Two classification rules come with it, one per target: an environment name
carries the client and the app, a repository name carries only the app. That is
what fills the dimension filters — `env`, `client`, `app` — and the reason the
same `app` value has to be extracted identically on both sides, as
[DORA metrics](dora.md) warns.

## Four properties it holds to

**Anchored to now.** Everything is generated relative to the moment it runs, so
the overview says "8 minutes ago" rather than naming a date last spring. Run it
again in six months and the organization is six months younger.

**Deterministic.** One seeded generator, no `Math.random`: two runs produce the
same organization down to the commit shas. That is what makes a screenshot
reproducible and a bug report on the demo comparable to anybody else's.

**Idempotent.** It owns one source, by slug, and rewrites it whole. A real
source on the same install is never touched — and `make demo-clear` removes the
demo without touching anything else.

**Coherent.** The metric history is not a decorative curve: it is computed from
the events that were just generated, over the same trailing window the
collection uses. So the chart on a metric page and the value above it tell the
same story, which is exactly the property a demo dataset usually breaks.

## What it does not do

- **No credential is created**, so *Test* and *Collect now* on that source fail,
  as they should — there is no `acme` organization to reach.
- **No incidents, no trackers, no release notes.** Release notes read tags and
  commits from a platform in either mode, so they cannot be demonstrated without
  one. The changelog archive is what shows the same reading of commits offline.
- **Nothing is scheduled.** The demo source is `stored` and its data never
  moves; the collection has nothing to do for it.

## Where it lives

`back/src/scripts/seed-demo.ts`, next to `set-password.ts` and run the same way
— compiled into the image, executed inside the API container where
`DATABASE_URL` exists. The generation is a pure function and is
[tested](../../back/src/scripts/seed-demo.spec.ts): that it stays the same
organization run to run, that its environment names are readable by the rules it
installs, and that the history it publishes is the one its own events add up to.
