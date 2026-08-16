-- Deployment frequency became a rate per day, where it was a count over the
-- collection window. Historised readings hold the old count, and a count is
-- unreadable on its own: nothing records the window it was taken over, so a
-- series spanning a change of `doraWindowDays` already stepped for no reason.
--
-- They are converted rather than dropped: the shape of the history is worth
-- more than the exactness of a figure nobody could interpret anyway. The
-- divisor is the window configured now, which is right for every install that
-- never changed it and no worse than the count for the ones that did. A
-- `POST /sources/:id/dora/rebuild` replays the depth it covers from the events
-- themselves, exactly.
--
-- Failed deployments used to count here and no longer do, which no arithmetic
-- can undo — the rows do not say how many of them there were. The replay is the
-- only way to take them back out.
UPDATE "MetricSnapshot"
SET "value" = "value" / GREATEST(
  COALESCE(
    NULLIF((SELECT s."value" FROM "AppSetting" s WHERE s."key" = 'doraWindowDays'), '')::numeric,
    30
  ),
  1
)
WHERE "metric" = 'deployment_frequency';
