-- Where a deployed environment can be reached, when the platform states one.
-- Nullable because most deployments carry none: on GitHub it is written on a
-- deployment status, on GitLab it is set on the environment or not at all.
ALTER TABLE "StoredDeployment" ADD COLUMN "environmentUrl" TEXT;
