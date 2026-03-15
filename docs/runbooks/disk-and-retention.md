# Disk and retention

Most of what the database holds is bounded by a sweep. One table is not, by
design, and it is the one that grows for ever.

## What is swept, and what is not

The `prune` job runs on `pruneCron` (03:00 daily by default) and drops, per
source, whatever is older than that source's depth — `historyDays`, falling back
to the reporting window — extended by `retentionMarginDays` (7):

- `StoredPipeline`, `StoredDeployment`, `StoredPullRequest`, open pull requests
  excepted — one opened two years ago is exactly what the stale-PR tile is for;
- `WebhookDelivery`, on a retention of its own: 7 days.

Never swept:

- **`MetricSnapshot`**, deliberately. It is the metric history, and dropping its
  tail would silently shorten every chart. It grows by roughly
  *metrics × dimension combinations* per collection.
- **`DeploymentChangelog`**, deliberately. It is the one table that cannot be
  rebuilt from the platform.

## Where the size is

```bash
$C exec -T db psql -U dashboard dashboard -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS rows
  FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;"
```

If `MetricSnapshot` leads by an order of magnitude, that is expected. If
`StoredPipeline` or `StoredDeployment` does, the sweep is not running — check
**Settings › Background jobs** for the `prune` schedule, and
[Nothing is being collected](collection-stalled.md).

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

Postgres does not return deleted rows to the filesystem on its own:

```bash
$C exec -T db psql -U dashboard dashboard -c 'VACUUM (ANALYZE) "MetricSnapshot";'
```

`VACUUM FULL` returns it properly but takes an exclusive lock on the table for
the duration — fine on an install nobody is reading, not on one somebody is.

## Redis

Bounded on both ends already: the last 200 completed and 500 failed jobs per
queue. Failures are kept deeper because a success is a count and a failure is
something somebody has to read. Nothing to do here.
