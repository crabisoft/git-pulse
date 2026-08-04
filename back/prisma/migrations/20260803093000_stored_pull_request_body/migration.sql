-- The pull request's description, so a ticket rule declaring it reads the same
-- text in `stored` mode as in `live`. Nullable rather than defaulted to '':
-- a row the merged feed created has never been told what the description is,
-- which is not the same as knowing it to be empty.
ALTER TABLE "StoredPullRequest" ADD COLUMN "body" TEXT;
