# Git Dashboard

**Self-hosted** monitoring dashboard for Git platforms: a live PR/MR & pipeline
view, on a foundation ready for DORA historization, AI-assisted release notes
and extended metrics. Adding a platform means adding a connector — nothing in
the model, the UI or the metrics names one.

> Full specification: see the scoping document shared with the team.

## Common commands

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
| `make build` | Full monorepo build |
| `make clean` | Clean build artifacts |

Targets delegate to the npm scripts and the Docker wrapper described below.

## Stack

| Layer | Technology |
|--------|--------|
| Frontend | React + TypeScript (Vite) |
| Backend | NestJS (TypeScript) |
| Database | PostgreSQL (Prisma) |
| Jobs / cache | Redis (BullMQ) |
| Sources | one client per connector — Octokit, @gitbeaker |

**npm workspaces** monorepo: `back`, `front`, `packages/shared`.

## Architecture

- **`SourceConnector`** — common interface: an implementation per platform
  normalizes PRs/MRs, pipelines and deployments into the shared types. Two ship
  today, `GitHubConnector` and `GitLabConnector`, and adding a third changes
  nothing else. Base URLs are configurable, so self-hosted and enterprise
  instances are the same case as the public ones.
- **`CryptoModule`** — secrets (tokens, keys) encrypted at rest with
  AES-256-GCM. The master key is generated on first boot into a `0600` file, or
  supplied through `MASTER_KEY` (base64) for Kubernetes / a secret manager.
- **`SourcesModule`** — source CRUD plus connection testing.
- **`DashboardModule`** — live aggregation per source.
- **`ApiQuotaModule`** — what each source has spent of its platform's rate
  limit, read from the responses themselves.

## Navigation (front)

Every module, section and page has its own URL — react-router in
`BrowserRouter` mode, the SPA fallback already being handled by nginx in prod
and by Vite in dev.

| URL | Page |
|---|---|
| `/dashboard/:slug` | Live view of a source |
| `/dora/:slug` | DORA metrics for a source |
| `/dora/:slug/:metric` | One metric: its trend, then the events behind it |
| `/login` | Sign in — or create the first admin on a fresh install |
| `/settings/general` | Application settings |
| `/settings/users` | Accounts allowed to sign in |
| `/settings/sources` | Connected Git platforms |
| `/settings/environments` | Classification rules, global catalogue (`?target=repository` for the repos tab) |
| `/settings/trackers` | Ticket trackers (Jira, Linear, issues) |
| `/settings/tickets` | Ticket rules (PR → ticket linking) |

`/`, `/dashboard`, `/dora` and the source-bound settings sections redirect to
the first source; `/settings` to `/settings/general`; everything else to the
dashboard.

**Settings is an application-wide module**, and every section in it is global:
classification rules are a shared catalogue, ticket rules belong to their
tracker. Nothing there reads the topbar source picker, which is why it is hidden
under Settings — what a given source uses is declared on the source itself, in
the Sources section.

The source segment is the **slug** (`Source.slug`), a URL-safe and unique form
of the name: `SISMIC — Prod` gives `/dashboard/sismic-prod`. Two sources with
the same name are disambiguated by a suffix (`prod`, `prod-2`). The API itself
keeps addressing sources by `id`: the front resolves slug → id from the list it
already loads for the picker, with no extra request.

The URL is the picker's source of truth: changing it keeps the current page and
replaces only the slug. An unknown slug — deleted or renamed source — falls
back to the first source, or to the empty state if none remain.

> The slug follows the name: **renaming a source invalidates its older links**.
> The fallback avoids a dead page, but the link no longer points at the same
> source.

## Accounts and access

Three levels, and every route carries one:

| Level | Who passes |
|---|---|
| `anonymous` | anyone — signing in, signing out, reading the session state |
| `viewer` | any account, plus anonymous visitors while the dashboard is public |
| `admin` | admins only |

`AuthGuard` is registered globally and **defaults to `admin`**: a route that
says nothing is closed, so a new endpoint is protected by existing rather than
by someone remembering to guard it. Dashboard, DORA, metrics, release notes and
the two reads the front needs to draw them — `GET /sources`, `GET /settings` —
are marked `@Viewer()`. Everything else, the whole configuration surface
included, stays with the admins.

**Public dashboard** (`Settings → General`) is what `viewer` reads. On, the
dashboard and DORA are readable without an account, which is the default and
what an upgraded install keeps. Off, the whole application asks for one. The
settings never depended on it: they are `admin` either way.

Roles are coarse on purpose — `admin` configures the install, `user` only reads
what the public setting would otherwise open to everyone. Accounts are handed
out from `Settings → Accounts`; there is no self-registration.

**First run.** An install with no account at all offers to create the first
admin, and only then: the bootstrap closes for good as soon as one exists. The
same screen becomes the sign-in form afterwards.

**Sessions** live in the database rather than in a signed token, so signing out,
deleting an account or taking away its role takes effect at once instead of
whenever a token happens to expire. The cookie is `httpOnly` and `sameSite=lax`,
holds a random 32-byte value, and only its SHA-256 is stored — a leaked table
hands out nothing. Passwords are scrypt-hashed with a per-account salt.
`secure` follows `WEB_ORIGIN` being HTTPS, which `SESSION_COOKIE_SECURE`
overrides for a proxy that terminates TLS elsewhere.

## Tests

`make test` (or `npm test`) runs **vitest** over both workspaces.

On the **back**, the pure engines — the classification matcher, the DORA maths
and the ticket extractor. They take plain values and return plain values, so
that half boots no Nest container and no database.

On the **front**, what sits between a click and a request: the API client's
query building and error mapping, the debounce and cancellation hooks, the
shared multiselect, and the window presets.

The multiselect wraps **react-select** in `unstyled` mode — the behaviour it
brings (keyboard, ARIA, type-to-filter, a menu that escapes its container) with
the app's own CSS on top, so no second visual language enters the forms. The
menu is portalled to the body: as an absolutely positioned child of
`.modal-body`, which scrolls, it was clipped whenever it opened near the bottom
of the source form. The library costs about 30 kB gzipped, which is the price of
that list. Components render under jsdom with
translations stubbed to echo their key — what a screen *says* is the
translators' business, what it *does* is what is asserted.

Two suites step outside that rule and boot a **real client**: the quota metering
seams hook Octokit's request hooks and gitbeaker's built requesters, which no
type check covers and no upgrade announces. They run the actual clients against
a stubbed transport, so a library moving its seam fails there rather than in
production — where the only symptom would be a gauge that quietly stopped
moving.

The pure engines came first on purpose: they are what every metric on screen is
derived from, and the only place where a silent change of behaviour goes
unnoticed. A regression there reads as plausible numbers, not as a crash.

What the suite pins down is the reasoning, not the implementation — that the
median is a median and not a mean, that a negative duration is clamped instead
of pulling a value down, that an unresolved incident stays out of MTTR rather
than counting as zero, that a rule whose pattern is broken is skipped instead of
throwing, and that a link with an unresolvable placeholder comes back absent
rather than malformed.

A large part of it asserts **rejection** rather than results, because that is
where the bugs have actually been: request DTOs validated against the same
`forbidNonWhitelisted` rules as the global pipe (a target the DTO had never
heard of once made the whole rule catalogue answer 400), a page size beyond the
cap, a dimension carrying no value, a cancelled request answering 499 rather
than a logged 500, an abort reaching the UI as silence rather than a red banner.

> Both halves are checked by mutation rather than by their green tick: turning
> the median into a mean, dropping the negative-duration clamp, removing the
> guard that stops a superseded run from clearing the loading flag, or joining a
> repeated query parameter with commas each fails the suite. A suite that stays
> green under those proves nothing.

## Pagination on list routes

Every route returning a list accepts `?limit=&offset=` and answers
`{ items, page: { total, limit, offset, hasMore } }`. Omitting `limit` applies
the configured page size — the `pageSize` setting in the Settings section,
defaulting to `PAGE_LIMIT_DEFAULT` (10) on a fresh install. `limit` stays
capped at `PAGE_LIMIT_MAX` (200); beyond that the request is rejected with a
400.

`GET /api/dashboard/:sourceId/live` aggregates three lists and therefore
exposes one window per list — `prsLimit`/`prsOffset`,
`pipelinesLimit`/`pipelinesOffset`, `environmentsLimit`/`environmentsOffset` —
plus a `repos` filter (repeatable or comma-separated) applied upstream: the
`summary` counters cover the whole filtered set, never just the returned
window.

## Classification rules

A rule is a RegEx **defined once for the whole install**, then enabled source
by source from the source form. A pattern describes a naming convention, and a
convention rarely stops at one repository host — binding rules to a single
source meant retyping them for the next one.

Two independent axes:

- **`kind`** — `simple` extracts attributes through named groups (`(?<app>…)`
  yields `app=…`); `meta` only tests membership and adds the **rule name** as a
  meta-environment. A `meta` rule ignores its named groups entirely.
- **`target`** — `environment` applies to deployment environment names,
  `repository` to repo names, `incident` to incident labels.

`repository` rules exist because a pull request has no environment: without
them, `lead_time`, `coding_time`, `pickup_time` and `review_time` all fall into
a single global bucket. Classifying the repo name gives them the same
dimensions deployment metrics already have.

`incident` rules exist for the same reason: an incident has no environment
either, and its labels are how it joins the deployment dimensions. An incident
accumulates the attributes of every label it carries; on conflict the first
label wins, labels being sorted so the outcome does not depend on the tracker's
ordering.

`GET /api/env-rules?target=repository` lists the catalogue one target at a time
(`environment` by default). `POST /api/sources/:id/env-rules/classify` classifies
against the rules that source opted into, which is what the collectors use.
Patterns are tested **unanchored** — remember `^` and `$` if you want a match on
the whole name.

> A rule applies to nothing until a source selects it. `SourceEnvRule` carries
> the selection, written from the source form — with select-all and clear
> shortcuts, since a catalogue of dozens is the normal case.

## Ticket references

Pull requests are linked to their ticket by RegEx, from two texts and in that
order: the **branch name**, then the **PR title**. Both are free — the
connectors already receive `head.ref` / `source_branch` and the title with the
PR itself, so extraction costs no extra API call. PR comments are deliberately
not scanned: that would be one request per PR, on the heaviest path of the
product.

### Trackers

A **`Tracker`** is declared once — name, kind, base URL — in **Settings ›
Trackers**. The base URL lives there rather than on every rule, so moving a Jira
instance is a single edit.

**Attaching happens from the source**, not from the tracker: the question one
actually answers while setting things up is *what does this source use*, and a
source has two or three trackers where a tracker may serve twenty sources. The
source form therefore carries two controls, and the tracker list only shows its
sources read-only:

- **Attached trackers** — the ones this source's pull requests may reference,
  and the only ones its ticket rules can point at.
- **Incidents read from** — a **single** choice among them, or none. Single by
  design: two would leave the collector with no way to choose, which a boolean
  per binding made representable. Only kinds an incident provider exists for
  (`github`, `gitlab`) are offered, and the API refuses the others rather than
  failing mid-collection.

A source with no incident tracker collects no incident, whatever
`failureSource` says — the fallback is logged, since an empty metric otherwise
looks like an absence of failures.

Links are built from the tracker's `urlTemplate`, or from the shape derived from
its kind when it defines none:

| kind | default template |
|---|---|
| `jira` | `{base}/browse/{key}` |
| `linear` | `{base}/issue/{key}` |
| `github` | `{base}/{owner}/{repo}/issues/{key}` |
| `gitlab` | `{base}/{repo}/-/issues/{key}` |

`{owner}` and `{repo}` are resolved **per pull request** — a `#42` only becomes
a URL together with the repo it was filed against, which is why a git-hosted
tracker cannot be linked from a static template. When a placeholder cannot be
resolved the reference is returned without a URL, rather than with a hole in it.

> `{key}` is URL-encoded, `{owner}` and `{repo}` are not: on platforms with
> nested groups a repo reads `group/sub/project`, and its slashes are path
> separators rather than content to escape.

### Rules

`TicketRule` is kept apart from `EnvRule`: it yields references rather than
attributes. It belongs to a **tracker** and to nothing else — a key format is a
property of the tracker, not of a repository host — so which sources it applies
to follows from the sources attached to that tracker, and needs stating nowhere
else.

| Field | Role |
|---|---|
| `pattern` | the `(?<key>…)` named group yields the key; otherwise the whole match |
| `trackerId` | the tracker the rule belongs to, and through which it reaches sources |
| `priority` | lowest wins when two rules claim the same key |

Matching is global: a PR referencing two tickets yields both. The same key found
in the branch *and* the title is kept once, attributed to the branch. The
returned order is the discovery order — highest-priority rule first, branch
before title — so the PR's main ticket comes first.

> A loose pattern is the failure mode here: `[A-Z]{2,5}-\d+` also matches
> `UTF-8`, `SHA-256` and `RFC-2119`. The rule tester in **Settings › Tickets**
> exists for that — it runs every saved rule over a sample branch, title, org
> and repo, and shows the URL each reference resolves to, which a pattern check
> alone cannot validate.

References surface on the dashboard PR table and in the DORA lead-time samples.
Linking them to incidents — which would let the failure rate rest on a causal
link rather than on dimension alignment — is the natural next step, not done.

## Lead time, up to the deployment

The breakdown has four segments: `coding_time` (first commit → opened),
`pickup_time` (opened → first review), `review_time` (first review → merged)
and `deploy_time` (merged → the deployment that carried it).

**Not every platform has a review object.** Where one does not, the first
comment left by somebody other than the author stands in for it, system notes
excluded — a label change is the platform talking, not a reviewer. It is an
approximation and the metric help says so, but the alternative was two segments
permanently empty, which reads as "instant" rather than "not measurable here".
It costs one call per merged request, the same as the platforms that do expose
reviews.

That last one needs a **pull request tied to a deployment**, which no connector
gives directly: they expose a deployment's ref, never the commits it contains.
The correlation is therefore by repository and time — the earliest *successful*
deployment of that repo after the merge. A change merged just before a
deployment that did not include it is attributed to it anyway, so read
`deploy_time` as an upper bound rather than a per-commit truth.

`deploy_time` is grouped by the **deployment's** dimensions where the other
three use the pull request's: how long a change takes to arrive is a property of
where it lands, so filtering on `type=Prod` answers "time to production" with no
extra setting.

## Metric trends

Clicking a metric opens `/dora/:slug/:metric`, which shows how it moved and then
what it is made of. The filters travel in the link, spelled as the API takes
them: a value computed over another period is a different number, so the page
reads exactly the report the list was showing rather than re-picking a period on
arrival.

The trend comes from the historised snapshots through
`GET /api/sources/:id/metrics/series`, **bucketed server-side**. The collection
runs every few minutes, so a year of raw snapshots is tens of thousands of rows
— more than a page window carries and more than a plot can say anything with.
Each bucket keeps its **last** reading rather than an average: a DORA value is
already an aggregate over a rolling window, and averaging aggregates would blur
two different things together.

An omitted dimension filter means the combination with **no** dimension, not
"every combination": summing unrelated slices into one line would be
meaningless.

> The chart is one series, so it carries no legend — the heading names it — and
> it states its own endpoints in text, below the plot and as its accessible
> name. Its colour is a token of its own rather than `--accent`: the dark accent
> sits outside the lightness band a mark needs to read against the dark surface.
>
> The charting library is a third of the bundle, so the page is loaded on
> demand: the main bundle grew by 2 kB gzipped, and only opening a metric pays
> the rest.

## Incidents and failure rate

The `failureSource` setting decides what counts as a failure for **change
failure rate** and **MTTR**:

| Value | Rate numerator | MTTR |
|---|---|---|
| `pipelines` (default) | failed deployments | failure → next successful deployment in the same env |
| `incidents` | incidents opened | opened → resolved |
| `both` | either | median over the union of both |

Incidents come from an `IncidentProvider`, an abstraction kept **separate** from
`SourceConnector`: a standalone tracker has neither repos nor pipelines and
could not honour the latter. The implementations that ship are the Git-hosted
ones, reading issues **with the Git source's own credentials** — nothing to
configure beyond the labels. Both of their APIs read a multi-label filter as an
AND where an OR is wanted, hence one call per label and per repo, then dedup.

`incidentLabels` is required as soon as `failureSource` leaves `pipelines`,
otherwise **every** issue in scope would become a production failure.

### Tying a failure to the change that caused it

An incident that mentions a ticket, a merged pull request that mentions the same
one, and the deployment that carried that request: the trail says which
deployment broke what. The incident is then counted against **that deployment's
slice**, whatever dimensions it carries itself.

This is what DORA asks of a change failure rate — deployments that broke
something — where matching on dimensions alone only asks whether a failure
happened in the same slice. Incidents sharing no ticket fall back to that slice,
so nothing is lost while the ticket rules are still thin, and the link improves
the numbers as the rules fill in. Ticket references are read from an incident's
title and labels, by the very same rules that read branch names and PR titles.

> The rate's denominator is **always** the number of deployments. A dimension
> combination carrying incidents but no deployment therefore yields no rate at
> all — it would be a division by nothing. Those orphan combinations are
> **logged as warnings**: they are the symptom of a mismatch between attributes
> extracted from incident labels and those extracted from environment names, and
> the causal link above is what makes them disappear. MTTR has no such problem —
> it divides nothing, so it also reports slices known only through their
> incidents.

An incident still open stays out of MTTR: with no resolution date it has no
restore time, and counting it as zero would drag the median down instead of up.
Under `both` the rate may exceed 100% when incidents outnumber deployments in a
slice — deliberately unclamped, since a ceiling would only hide a misconfigured
label filter or misaligned dimensions.

## DORA metric filters

`GET /api/sources/:id/dora` answers a `DoraReport`: the paginated results, plus
the vocabularies the filter controls need (`repos`, `dimensions`) and the
`period` actually applied.

| Parameter | Effect |
|---|---|
| `from` / `to` | Period, ISO dates, inclusive bounds |
| `windowDays` | Rolling window in days, ending at `to` |
| `repos` | **Scopes collection** (repeatable or comma-separated) |
| `dimension` | **Slices the results**, repeatable `key:value` pairs |

`?from=2026-01-01&to=2026-01-31&repos=extranet-api&dimension=app:Extranet&dimension=type:Prod`

Two distinct kinds of filter:

- **`repos` acts before the connectors.** Since they iterate repo by repo, a
  shorter list means *fewer* API calls, not more.
- **`dimension` acts after computation.** All pairs must match.

Vocabularies are computed **before** slicing — narrowing a filter never empties
the list you pick from, and `repos` stays complete even when the current
selection returns nothing.

### Period

Three ways to request a period, in decreasing precedence: an explicit `from`, a
`windowDays` rolling window, then the `doraWindowDays` setting. A date without
a time (`2026-01-31`) is taken at end of day UTC, and an omitted `to` means
now. With no parameter you therefore get the rolling window from settings —
which is what the scheduled snapshot does, deliberately left unfiltered so that
history and sparklines stay consistent.

`period.windowDays` returns the window actually applied, or `null` when `from`
was explicit. That is what lets the DORA page show the entry matching the
current setting right away, without replaying the fallback logic on the front.

On the DORA page, the "Custom" entry captures the bounds in a modal and only
re-runs the computation on submit: every DORA request triggers a burst of
connector calls, too expensive to replay on each keystroke in a date field. A
bound left empty stays open.

The period picker — DORA page and settings alike — offers the same values
(`DORA_WINDOW_PRESETS`: 15 d, 1, 2, 3, 6 months, 1 and 2 years; a month counts
as 30 days, a year as 365). The API itself accepts any value between
`DORA_WINDOW_MIN` and `DORA_WINDOW_MAX`: an already-stored window outside the
presets therefore stays offered in the list rather than being silently
rewritten.

> Attributes of `environment` and `repository` rules share the same namespace.
> If `app` exists on both sides, the values must be **identical to the
> character**: `app=Extranet` on environments and `app=extranet` on repos would
> yield two distinct entries, and filtering on one would exclude the other's
> metrics.

### Request pacing (front)

Both the dashboard and the DORA page fire an expensive request on every state
of their filters. Two safeguards, shared in `front/src/hooks.ts`:

- **`useDebounced` (500 ms)** — ticking repos one at a time, or paging through
  results, emits a single request once the burst is over. This is what spares
  the back: a cancelled request is still computed server-side, NestJS does not
  stop because the client hung up.
- **`useCancellableLoad`** — every load cancels the one it supersedes, and
  leaving the page cancels too. Guarantees the view shows the answer to its
  latest question, not whichever reply lands last.

An abort is not an error: `isAbort()` singles it out in `api.ts` so a
cancellation never shows up as a red banner, and the abandoned load leaves the
`loading` flag to whichever load replaced it.

### Cancellation on the back

Closing the connection is not enough to stop Nest: left alone, collection would
run to completion for a response nobody will read. Both expensive routes
(`/dashboard/:id/live` and `/sources/:id/dora`) therefore propagate the
abandonment down to the connectors.

`abortOnDisconnect(res)` (`common/request-abort.ts`) listens for `close` on the
**response** — which signals either a normal end or a dropped connection, with
`writableEnded` telling the two apart. The signal then travels in
`ConnectorContext`, which already reaches every `SourceConnector` method: no
signature to change.

A connector honours it in two ways:

- **At the HTTP level**, when the client allows it. Octokit accepts
  `request: { signal }` set at construction, which covers all of its calls,
  `paginate()` included. gitbeaker does not let it through: its helper rebuilds
  the signal from `queryTimeout` and pushes the caller's into the query string.
- **Between two repos**, through `ctx.signal?.throwIfAborted()` in each loop —
  and in the inner loops that trigger one call per PR/MR. That is the safeguard
  that matters: the cost is the fan-out, not an isolated call. It depends on no
  library, so it covers every connector, including those whose client refuses
  the signal.

Two consequences worth keeping in mind:

- The services' best-effort `catch` blocks (a missing permission degrades into
  partial metrics) call `throwIfAborted(signal)` **before** degrading. A
  cancellation has nothing to degrade: it must stop the work, not return an
  empty list that would look like "no data".
- A cancelled request answers **499** (`errors.aborted`), outside the 5xx
  bucket: the filter does not log it as a server error. Scheduled collection
  has no signal — nobody is waiting on it, nothing cancels it.

## API quotas

Every platform meters what it is asked, and the collection's cost is its
fan-out: one call per repo, plus one per merged pull request for the lead-time
segments and one per deployment for its status. Knowing where a source stands
has to come before deciding what to do about it — this is the measuring half,
and it changes no behaviour: nothing here throttles, delays or refuses a call.

**The ceiling is read, not configured.** Both platforms send their counters on
every response, and a figure typed into a form goes stale the day the plan, the
token or the instance's settings change. `ApiQuota` therefore records where each
reading came from, and a declared one is marked as such in the UI — a
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

Declaring a ceiling for the instances that meter nothing, then degrading the
optional work before the limit is reached rather than being refused at it, is
the next step — not done.

## Release notes

`GET /api/sources/:id/release-notes?repo=&from=&to=` summarises a range of
commits; `GET /api/sources/:id/tags?repo=` lists what a range can be picked
from.

Bounds fill themselves in: `to` defaults to the most recent tag — a release is
summarised as it was cut, not as the branch has drifted since — and `from` to
the tag below it. With no tag at all the range runs from the beginning of
history to the default branch, which is what a first release needs.

Each commit is read as a **Conventional Commit** and filed under its type, with
breaking changes repeated at the top: they are what a reader upgrading needs
first. A message following no convention is filed under `other` rather than
dropped, since most histories are mixed. The parser is deliberately strict —
`Reverting this: fix login` yields nothing rather than a type named `reverting`.

Ticket references are read from commit messages by the **same rules** as branch
names and PR titles, so a release note links its tickets without any further
configuration.

> Only the Markdown is produced for now. AI rewriting through an `LLMProvider`
> and publishing the notes back as a platform release are the remaining steps of
> this phase; the first needs `Credential` generalised to a polymorphic owner,
> which has been deferred until it had a consumer.

## Getting started — Docker (recommended)

All the Docker configuration lives in `.docker/`:

```
.docker/
  docker-compose.yml       # base: db + redis
  docker-compose.dev.yml   # DEV override: watch / HMR, code mounted as a volume
  docker-compose.prod.yml  # PROD override: built images + nginx
  Dockerfile.back · Dockerfile.front · nginx.conf
  .env                     # versioned defaults (no real secrets)
  .env.local               # your local overrides (git-ignored)
  .env.local.example       # template to copy
  compose.sh               # wrapper: mode + .env/.env.local chaining
```

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

## Getting started — local (dev)

Prerequisites: Node 20+, a reachable PostgreSQL and Redis (see `.env`).

```bash
npm install
npm run build:shared
npm run db:deploy                        # applies the migrations
npm run dev:back                         # http://localhost:3001
npm run dev:front                        # http://localhost:5173
```

## Configuring a source

1. **Sources** tab → *Add a source*.
2. Platform, base URL (e.g. `https://gitlab.example.com`), organization/group,
   auth method and secret (token). The secret is encrypted immediately.
3. **Test** the connection, then switch to the **Dashboard** tab.

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

## Roadmap

Shipped:

- Foundation, connectors, encryption, live dashboard.
- Historization + DORA (4 metrics + lead time breakdown), RegEx environment
  engine (meta-env, priority + accumulation), BullMQ jobs.
- API quota metering, read from the platforms' own rate-limit headers.

Planned:

- Declared API budgets for the instances that meter nothing, then degrading
  collection ahead of the limit instead of being refused at it.
- Release notes tag→tag with AI rewriting (multi-provider `LLMProvider`),
  Release publishing.
- Review/CI/throughput metrics, alerts and thresholds.
