# Disk and retention

Most of what the database holds is bounded by a sweep. One table is not, by
design, and it is the one that grows for ever.

## What is swept, and what is not

The `prune` job runs on `pruneCron` (03:00 daily by default) and drops, per
source, whatever is older than that source's depth — `historyDays`, falling back
to the reporting window — extended by `retentionMarginDays` (7):

| Table | What decides its age | Kept for |
|---|---|---|
| `StoredPipeline` | `createdAt` | depth + margin |
| `StoredDeployment` | `createdAt` | depth + margin |
| `StoredPullRequest` | `updatedAt`, closed and merged only | depth + margin |
| `WebhookDelivery` | `receivedAt` | 7 days, install-wide |

Two lines of that table are worth reading twice:

- A pull request is judged on **`updatedAt`**, so one closed a year ago and
  commented on last week is still here. That is intended — what is still being
  touched is still being read — but it is not what a depth in days sounds like.
- The deliveries' seven days are **fixed and install-wide**: not a setting, not
  per source. They exist to recognise a repeat, and providers give up retrying
  in hours, not days.

The margin runs from 0 to 365 days, and zero sweeps exactly at the depth. It is
a grace period, not a second depth: an install that wants two years of history
says so on its sources, where the ingestion can actually go and fetch them.

Never swept:

- **Open and draft pull requests.** One opened two years ago is exactly what the
  stale-PR tile is for. The cost is real and it is not a leak: a source with a
  long tail of forgotten open PRs grows without bound, and no sweep will ever
  trim it.
- **`MetricSnapshot`**, deliberately. It is the metric history, and dropping its
  tail would silently shorten every chart. It grows by roughly
  *metrics × dimension combinations* per collection.
- **`DeploymentChangelog`**, deliberately. It is the one table that cannot be
  rebuilt from the platform.

## Forcing it, checking it, waiting for it

**There is no way to run the sweep on demand.** No route, no button — the jobs
page retries a failed job and discards one, it does not enqueue this one. The
only lever is `pruneCron` itself, in **Settings › General**, and it reschedules
hot: set it a few minutes out, let it fire, set it back. No restart.

To check it is scheduled at all, **Settings › Background jobs** lists the
repeatable jobs of each queue — look for `prune-store` on `collection`, with its
pattern and its next occurrence.

Do not read the logs as proof. `Store swept: …` is written **only when something
was deleted**: a sweep that found nothing to do says nothing at all, and that
silence is indistinguishable from a sweep that never ran. The next occurrence on
the jobs page is the answer; the absence of a log line is not.

The job carries **no retry**, on purpose — the cron brings it back on its own.
So a failed sweep is not caught up: it waits for the next occurrence, and sits
in the queue's failures until then.

## After changing a depth

Neither direction takes effect when you press save.

- **Narrowing** deletes nothing immediately. The rows go at the next sweep, and
  only past depth *plus margin* — which is precisely what the margin is for: a
  fortnight configured yesterday and widened to a month today still has its
  fortnight.
- **Widening** does not bring the history back immediately either. Only a
  reconciliation reads that far, and those run every six hours. To force one:
  `POST /sources/:id/refresh` with `historyDays`, which writes the depth to the
  source before re-reading — a depth applied to a single run would be swept away
  the same night.

Either way, **Sources** states what each one actually holds under its row —
`depth 60 d · history held 47 d · DORA 12 d`, with the breakdown per table
behind the `?`. That is where a widening is confirmed as having landed, and
where a narrowing shows up once the sweep has passed. The figure turns amber
while the store is shallower than the depth it claims, which is normal for the
hours after a widening and a symptom at any other time — see
[Nothing is being collected](collection-stalled.md).

A narrowing then takes its whole effect in one sweep, and that sweep is a single
transaction: every source's three deletions and the deliveries, together. On a
loaded install the first one after a large narrowing runs long and holds its
locks for the duration. Step the depth down over a few nights rather than
dropping it in one go, and leave it to the nightly occurrence rather than
forcing it at noon.

## Where the size is

```bash
$C exec -T db psql -U dashboard dashboard -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS rows
  FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;"
```

If `MetricSnapshot` leads by an order of magnitude, that is expected. If
`StoredPipeline` or `StoredDeployment` does, the sweep is not running — see
[Forcing it, checking it, waiting for it](#forcing-it-checking-it-waiting-for-it)
above, then [Nothing is being collected](collection-stalled.md).

## Slowing the snapshot table down

Its growth is a product of three numbers, and only two are yours:

1. **The collection interval.** Every fifteen minutes is 96 captures a day; every
   hour is 24, and no chart reads differently for it. This is the setting to
   change first — `Settings › General`.
2. **The number of dimension combinations.** One row is written per metric *per
   combination*, so a classification that extracts four attributes with several
   values each multiplies the table. Rules that produce combinations nobody
   filters on are pure cost: `Settings › Environments`.
3. The number of metrics, which is fixed.

## Trimming it anyway

There is no supported command for this, and the reason is in
[Collection and metrics](../technical/collection-and-metrics.md): the history is
not recomputable. Deleting a range deletes it from every chart, permanently, and
no future collection fills it back in.

If an install has to reclaim the space regardless — say a year of
fifteen-minute captures nobody reads at that resolution — back up first, then
thin the oldest range rather than dropping it, keeping one capture per day:

```sql
-- Keep the last reading of each day, older than 180 days. Back up first.
DELETE FROM "MetricSnapshot" s
WHERE s."capturedAt" < now() - interval '180 days'
  AND s.id <> (
    SELECT s2.id FROM "MetricSnapshot" s2
    WHERE s2."sourceId" = s."sourceId" AND s2.metric = s.metric
      AND s2.dimensions = s.dimensions
      AND date_trunc('day', s2."capturedAt") = date_trunc('day', s."capturedAt")
    ORDER BY s2."capturedAt" DESC LIMIT 1
  );
```

That mirrors what the series endpoint does when it buckets by day — it keeps the
last reading of each bucket — so a daily chart looks identical afterwards, and
only a finer resolution is lost.

## Reclaiming the space afterwards

Postgres does not return deleted rows to the filesystem on its own, and this
holds after any large deletion — the thinning above, but equally the first sweep
that follows a depth narrowed by months:

```bash
$C exec -T db psql -U dashboard dashboard -c 'VACUUM (ANALYZE) "MetricSnapshot";'
$C exec -T db psql -U dashboard dashboard -c \
  'VACUUM (ANALYZE) "StoredPipeline", "StoredDeployment", "StoredPullRequest";'
```

`VACUUM FULL` returns it properly but takes an exclusive lock on the table for
the duration — fine on an install nobody is reading, not on one somebody is.

## Redis

Bounded on both ends already: the last 200 completed and 500 failed jobs per
queue. Failures are kept deeper because a success is a count and a failure is
something somebody has to read. Nothing to do here.
