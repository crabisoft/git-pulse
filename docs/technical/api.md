# API conventions

Rules that hold for every route rather than for one feature.

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

## Cancelling an abandoned request

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
