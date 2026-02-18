# API quotas

Every platform meters what it is asked, and the collection's cost is its
fan-out: one call per repo, plus one per merged pull request for the lead-time
segments and one per deployment for its status. Knowing where a source stands
comes first, and what to do about it follows from it — reading below, declaring
what cannot be read, and giving up the optional calls before the ceiling rather
than at it.

**The ceiling is read wherever it can be.** Both platforms send their counters
on every response, and a figure typed into a form goes stale the day the plan,
the token or the instance's settings change. `ApiQuota` therefore records where
each reading came from, and a declared one is marked as such in the UI — a
supposition must never read as a measurement.

| Provider | Headers | Buckets | Window |
|---|---|---|---|
| GitHub | `x-ratelimit-*`, bucket named by `x-ratelimit-resource` | `core`, `graphql`, `search`… metered apart | hour, `search` by the minute |
| GitLab | `ratelimit-*` | one | minute |

A self-hosted GitLab with rate limiting switched off sends none of them. That
yields **no** row rather than a zeroed one: 0/0 would show a full budget where
nothing was measured. Same reasoning on the gauge, where a reading whose window
has elapsed is drawn as expired rather than reset — the new window's counter is
unknown until a call is made in it.

Readings are taken on the response path of every call, held in memory and
written in batches: a run makes hundreds of calls that each carry the counters,
and writing on each would turn metering into a write amplifier. Failures are
read too — a 403 for a spent budget is precisely the reading worth keeping, and
dropping it would leave the gauge just short of the limit actually hit. Since
responses come back out of order and these headers are counters rather than
increments, the highest count of a window wins; a later reset date means the
window rolled over, where a drop is expected.

Two clients, two seams, neither of them a documented contract:

- **Octokit** exposes request hooks, which sit under `paginate()` and therefore
  cover every call an instance makes.
- **gitbeaker** exposes no response hook, and its default requester is private.
  Supplying our own `requesterFn` would mean re-implementing its retry and
  parsing rules and keeping them in step, so the requesters it has already built
  are wrapped instead: `Gitlab` assigns every resource as an own property, and
  each carries the requester its calls go through.

Gauges show up per source in **Settings › Sources**. Testing a connection is
also the cheapest way to get a first reading out of a source never collected —
it spends one call and flushes it straight away.

> Quotas are keyed by subject (`source` or `tracker`) rather than by relation:
> standalone trackers will carry their own credentials, and their budgets are
> counted in request cost or complexity points rather than in calls. Git-hosted
> trackers never appear — they spend their source's token, so their calls are
> billed to it. The polymorphic key rules out a foreign key, hence the explicit
> purge when a source is deleted.

## Declaring what an instance will not tell

A self-hosted instance with rate limiting switched off is not slower to reach a
limit — it is only silent about it, and the limit that stops the collection is
then the reverse proxy's, or the operator's patience. **Settings › Sources** takes
a ceiling by hand for such a source: so many calls per minute, hour or day.

The declaration is configuration and lives in its own table, `ApiBudget`, one
row per subject. The row it feeds in `ApiQuota` is a **count kept here**: every
call the connectors make is reported, counters or not, and a response carrying
none is charged to the declared bucket. The window is ours too — it opens on the
first call charged and lasts what was declared, since no provider states one.

> One ceiling per subject rather than one per bucket, because a response with no
> rate-limit header names no bucket either: there would be nothing to choose
> between two of them. Which bucket it charges follows from the platform —
> `core` for GitHub, `rest` for GitLab.

A measurement always wins: the first response that does carry counters marks the
source as metered, and the counting stops for good — a bucket both measured and
counted would bill every call twice. That also makes the declaration harmless on
a source that turns out to meter itself after all.

## Degrading before the ceiling, not at it

Being refused a call is the worst way to learn a budget was tight: the run stops
somewhere arbitrary, and what it had already collected is as partial as where it
happened to stop. **API reserve** (Settings › General, 10% by default) is the
share of a budget the optional calls may not dip into.

What counts as optional is the fan-out, and only the fan-out:

| Kept | Given up under the reserve |
|---|---|
| repos, pull requests, pipelines, deployments, incidents | first commit and first review of each pull request (2 calls each), status of each deployment (1 each) |

Giving those up costs the lead-time segments — `coding_time`, `pickup_time`,
`review_time` — and leaves a deployment with an `unknown` status, which keeps it
in the deployment frequency and out of the failure rate. Listing one repo fewer
would instead have cost every metric that repo feeds.

The question is asked **per item**, not once per run: consumption moves while a
run goes, and the point is to stop at the reserve rather than to have guessed
beforehand. It is answered from memory — the readings outlive their write for
that reason — and never from a query, since it sits in a loop over hundreds of
pull requests. What was skipped is logged, per source and per run: a metric that
silently thins out is worse than one that says why.

Consumption nobody knows degrades nothing: a source whose provider meters
nothing and for which no budget was declared attempts everything, as it always
did. Declaring the budget is what turns the reserve on for it.
