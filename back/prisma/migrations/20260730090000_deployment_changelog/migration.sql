-- What a deployment carried, frozen at the time it could still be read. Unlike
-- the stored mirrors beside it, nothing rebuilds this from the provider: the
-- environment is gone, the branch deleted, the record aged out. The retention
-- sweep therefore leaves it alone.
CREATE TABLE "DeploymentChangelog" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "baseRef" TEXT,
    "base" TEXT NOT NULL,
    "refUrl" TEXT NOT NULL,
    "baseRefUrl" TEXT,
    "deploymentUrl" TEXT,
    "environmentUrl" TEXT,
    "status" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "markdown" TEXT NOT NULL,
    "authors" INTEGER NOT NULL,
    "commits" INTEGER NOT NULL,
    "generator" TEXT NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentChangelog_pkey" PRIMARY KEY ("id")
);

-- One record per deployment: the archiver reads this to know what it has
-- already written, and a re-run must never file the same deployment twice.
CREATE UNIQUE INDEX "DeploymentChangelog_sourceId_deploymentId_key" ON "DeploymentChangelog"("sourceId", "deploymentId");

-- The history page reads by date, and filters by repo and environment.
CREATE INDEX "DeploymentChangelog_sourceId_deployedAt_idx" ON "DeploymentChangelog"("sourceId", "deployedAt");
CREATE INDEX "DeploymentChangelog_sourceId_repo_environment_deployedAt_idx" ON "DeploymentChangelog"("sourceId", "repo", "environment", "deployedAt");

ALTER TABLE "DeploymentChangelog" ADD CONSTRAINT "DeploymentChangelog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
