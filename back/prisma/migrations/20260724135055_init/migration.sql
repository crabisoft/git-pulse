-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('github', 'gitlab');

-- CreateEnum
CREATE TYPE "AuthKind" AS ENUM ('token', 'app');

-- CreateEnum
CREATE TYPE "EnvRuleKind" AS ENUM ('simple', 'meta');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authKind" "AuthKind" NOT NULL,
    "scope" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "kind" "EnvRuleKind" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: which sources a rule applies to. A rule describes a naming
-- convention, which rarely stops at one repository host, so it is defined once
-- and opted into per source.
CREATE TABLE "SourceEnvRule" (
    "sourceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceEnvRule_pkey" PRIMARY KEY ("sourceId", "ruleId")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Credential_sourceId_key" ON "Credential"("sourceId");

-- CreateIndex
CREATE INDEX "EnvRule_priority_idx" ON "EnvRule"("priority");

-- CreateIndex
CREATE INDEX "SourceEnvRule_ruleId_idx" ON "SourceEnvRule"("ruleId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_sourceId_metric_capturedAt_idx" ON "MetricSnapshot"("sourceId", "metric", "capturedAt");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEnvRule" ADD CONSTRAINT "SourceEnvRule_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEnvRule" ADD CONSTRAINT "SourceEnvRule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "EnvRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

