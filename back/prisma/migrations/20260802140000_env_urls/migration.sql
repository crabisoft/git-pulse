-- CreateEnum
CREATE TYPE "EnvUrlMode" AS ENUM ('fill', 'overwrite');

-- CreateTable
CREATE TABLE "EnvUrlRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "repo" TEXT,
    "urlTemplate" TEXT NOT NULL,
    "mode" "EnvUrlMode" NOT NULL DEFAULT 'fill',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvUrlRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceEnvUrlRule" (
    "sourceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceEnvUrlRule_pkey" PRIMARY KEY ("sourceId","ruleId")
);

-- CreateTable
CREATE TABLE "ManualEnvironment" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL,
    "url" TEXT,
    "attributes" JSONB,
    "mode" "EnvUrlMode" NOT NULL DEFAULT 'fill',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvUrlRule_priority_idx" ON "EnvUrlRule"("priority");

-- CreateIndex
CREATE INDEX "SourceEnvUrlRule_ruleId_idx" ON "SourceEnvUrlRule"("ruleId");

-- The pair, with an empty repo standing for "belongs to no repo": two nulls are
-- distinct in Postgres, so a nullable column would let one environment be
-- declared twice without the constraint noticing.
CREATE UNIQUE INDEX "ManualEnvironment_sourceId_repo_environment_key" ON "ManualEnvironment"("sourceId", "repo", "environment");

-- AddForeignKey
ALTER TABLE "SourceEnvUrlRule" ADD CONSTRAINT "SourceEnvUrlRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEnvUrlRule" ADD CONSTRAINT "SourceEnvUrlRule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "EnvUrlRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualEnvironment" ADD CONSTRAINT "ManualEnvironment_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

