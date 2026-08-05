-- Labels of a pull request, so the `pull_request` rules classify the same text
-- in `stored` mode as in `live`. Defaulted to the empty array rather than made
-- nullable: a request with no label and a row written before this column read
-- alike to a rule, since neither offers anything to match.
--
-- Not backfilled. Both platforms answer the labels a request carries today, so
-- a backfill would file this morning's labels under last quarter's merges.
ALTER TABLE "StoredPullRequest" ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
