# DORA metrics

What the four metrics are computed from, how a request narrows them, and
what the trend below a value is actually made of. Where the numbers come
from — and why the value and its chart are two different reads — is
[Collection and metrics](collection-and-metrics.md).

## Filters

`GET /api/sources/:id/dora` answers a `DoraReport`: the paginated results, plus
the vocabularies the filter controls need (`repos`, `dimensions`) and the
`period` actually applied.

| Parameter | Effect |
|---|---|
| `from` / `to` | Period, ISO dates, inclusive bounds |
| `windowDays` | Rolling window in days, ending at `to` |
| `repos` | **Scopes collection** (repeatable or comma-separated) |
| `dimension` | **Slices the results**, repeatable `key:value` pairs |

`?from=2026-01-01&to=2026-01-31&repos=portal-api&dimension=app:Portal&dimension=type:Prod`

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
(`DORA_WINDOW_PRESETS`: 7 and 15 days, 1, 2, 3, 6 months, 1 year; a month counts
as 30 days, a year as 365). The API itself accepts any value between
`DORA_WINDOW_MIN` and `DORA_WINDOW_MAX`, and the maximum is the wider of the
two — two years, the deepest a source can be ingested. An already-stored window
outside the presets therefore stays offered in the list rather than being
silently rewritten, which is what an install configured at two years before the
preset was dropped relies on.

> Attributes of `environment` and `repository` rules share the same namespace.
> If `app` exists on both sides, the values must be **identical to the
> character**: `app=Portal` on environments and `app=portal` on repos would
> yield two distinct entries, and filtering on one would exclude the other's
> metrics.

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
