-- CreateEnum
CREATE TYPE "SyncResource" AS ENUM ('repos', 'pulls', 'pipelines', 'deployments');

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "resource" "SyncResource" NOT NULL,
    "cursor" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastFullSyncAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredRepo" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredPullRequest" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "author" TEXT,
    "url" TEXT NOT NULL,
    "repoUrl" TEXT,
    "headRef" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "reviewers" INTEGER NOT NULL DEFAULT 0,
    "firstCommitAt" TIMESTAMP(3),
    "firstReviewAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredPipeline" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "repoUrl" TEXT,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredDeployment" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_sourceId_resource_key" ON "SyncState"("sourceId", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "StoredRepo_sourceId_name_key" ON "StoredRepo"("sourceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StoredPullRequest_sourceId_externalId_key" ON "StoredPullRequest"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "StoredPullRequest_sourceId_state_updatedAt_idx" ON "StoredPullRequest"("sourceId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "StoredPullRequest_sourceId_mergedAt_idx" ON "StoredPullRequest"("sourceId", "mergedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoredPipeline_sourceId_externalId_key" ON "StoredPipeline"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "StoredPipeline_sourceId_createdAt_idx" ON "StoredPipeline"("sourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoredDeployment_sourceId_externalId_key" ON "StoredDeployment"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "StoredDeployment_sourceId_createdAt_idx" ON "StoredDeployment"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredDeployment_sourceId_environment_createdAt_idx" ON "StoredDeployment"("sourceId", "environment", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncState" ADD CONSTRAINT "SyncState_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredRepo" ADD CONSTRAINT "StoredRepo_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredPullRequest" ADD CONSTRAINT "StoredPullRequest_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredPipeline" ADD CONSTRAINT "StoredPipeline_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredDeployment" ADD CONSTRAINT "StoredDeployment_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
