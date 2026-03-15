# Nothing is being collected

The symptom that hides best: **every page still works**. A `stored` source keeps
serving what it holds, the charts keep their shape, and the only thing that has
happened is that the numbers stopped moving. An install can sit like this for
days.

## Is it actually stalled?

The overview says so in its header:

- **`collected 8m ago`** — the age of the stored view. Growing past the
  collection interval is the signal.
- **`queues ok`** — Redis is answering. `unreachable` is the one worth acting
  on; `degraded` means jobs are failing.

Then **Settings › Background jobs**, which reads Redis at the instant: counts
per queue, when the schedule next fires, and the failures with the payload and
the platform's own message.

## Redis is unreachable

The API serves stored data perfectly well while nothing at all is collected
behind it, which is why this page exists.

```bash
$C ps                       # is the container up?
$C exec redis redis-cli ping
$C logs redis | tail -20
```

Restarting Redis is enough: the repeatable job is re-registered from the
settings when the API connects, and the delayed jobs that were lost cost one
cycle.

```bash
$C restart redis back
```

Losing the queue loses no data. Everything the collection writes is derived from
the platforms or already in the store.

## The schedule fires and the jobs fail

Look at a failure in **Settings › Background jobs**: it carries the payload it
was working on and the message the platform answered with. Three families:

| Message | What it is | What to do |
|---|---|---|
| 401, 403 on every repo | The credential expired, or its permissions were narrowed | Re-enter the token; check the permissions against [Sources](../technical/sources.md#what-to-grant-it) |
| 403 with a rate-limit reset date | The budget is spent | [The API budget is spent](api-quota-exhausted.md) |
| Timeouts, 5xx, DNS | The platform or the network | Retry the job from that page; a one-shot job retries three times on its own with a backoff |

A job can be retried or discarded from the page. The repeatable one is never
retried — the cron brings it back, and a second attempt would enqueue the whole
fan-out twice.

## The jobs complete, and the data does not move

**Completed with warnings** is its own list on that page. A collection catches
its best-effort steps, so a failing ingestion still snapshots what is stored —
the job goes green over a source that has stopped moving, and what it gave up on
is listed there.

The other case is a source in `live` mode: it collects snapshots on a schedule
but never fills a store, so there is no "stored view" to age. Its dashboard is
of the instant, and its charts are the only thing the collection feeds.

## The first collection is still running

A first run over a large scope takes minutes and walks the whole reporting
window repo by repo. Behind a reverse proxy, that is long enough to hit a
gateway timeout — the browser reports a network error while the collection
carries on server-side. **Settings › Background jobs** is where to look rather
than at the button that seemed to fail.

## Forcing one

```bash
# From the UI: Settings › Sources › Collect now, per source.
$C restart back      # re-registers the schedule, does not collect
```

There is no command-line collect: it is an admin route
(`POST /api/sources/:id/collect`) precisely so that it is authenticated, and the
button is the supported way in.
