-- Where the deployment itself is read on the platform. Nullable, and often
-- null: neither platform publishes a page for the record, so this holds the
-- nearest thing each one does — the run on GitHub, the job or the environment
-- on GitLab — and a GitHub run degraded under the API reserve reads none.
ALTER TABLE "StoredDeployment" ADD COLUMN "url" TEXT;
