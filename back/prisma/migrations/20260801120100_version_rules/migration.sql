-- CreateEnum
CREATE TYPE "VersionFormat" AS ENUM ('json', 'xml', 'text');

-- CreateEnum
CREATE TYPE "VersionAuthKind" AS ENUM ('none', 'bearer', 'basic', 'header');

-- CreateTable
CREATE TABLE "VersionRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT,
    "repo" TEXT,
    "urlTemplate" TEXT NOT NULL,
    "format" "VersionFormat" NOT NULL DEFAULT 'json',
    "template" TEXT NOT NULL,
    "pattern" TEXT,
    "headers" JSONB,
    "authKind" "VersionAuthKind" NOT NULL DEFAULT 'none',
    "authHeader" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VersionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VersionRule_priority_idx" ON "VersionRule"("priority");

-- CreateTable
CREATE TABLE "SourceVersionRule" (
    "sourceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceVersionRule_pkey" PRIMARY KEY ("sourceId", "ruleId")
);

-- CreateIndex
CREATE INDEX "SourceVersionRule_ruleId_idx" ON "SourceVersionRule"("ruleId");

-- CreateTable
CREATE TABLE "EnvironmentVersion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "version" TEXT,
    "deploymentId" TEXT,
    "ref" TEXT,
    "ruleId" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL,
    "error" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "changedAt" TIMESTAMP(3),

    CONSTRAINT "EnvironmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentVersion_sourceId_repo_environment_key" ON "EnvironmentVersion"("sourceId", "repo", "environment");

-- CreateIndex
CREATE INDEX "EnvironmentVersion_sourceId_observedAt_idx" ON "EnvironmentVersion"("sourceId", "observedAt");

-- CreateIndex
CREATE INDEX "EnvironmentVersion_ruleId_idx" ON "EnvironmentVersion"("ruleId");

-- CreateTable
CREATE TABLE "VersionChange" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "deploymentId" TEXT,
    "ref" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VersionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VersionChange_sourceId_repo_environment_observedAt_idx" ON "VersionChange"("sourceId", "repo", "environment", "observedAt");

-- AddForeignKey
ALTER TABLE "SourceVersionRule" ADD CONSTRAINT "SourceVersionRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceVersionRule" ADD CONSTRAINT "SourceVersionRule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "VersionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentVersion" ADD CONSTRAINT "EnvironmentVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The reading outlives the rule that took it: deleting a rule does not make an
-- environment stop running what it was seen running.
ALTER TABLE "EnvironmentVersion" ADD CONSTRAINT "EnvironmentVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "VersionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionChange" ADD CONSTRAINT "VersionChange_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
