-- CreateEnum
CREATE TYPE "RuleTarget" AS ENUM ('environment', 'repository');

-- AlterTable: existing rules all classify environments.
ALTER TABLE "EnvRule" ADD COLUMN "target" "RuleTarget" NOT NULL DEFAULT 'environment';

-- DropIndex
DROP INDEX "EnvRule_sourceId_priority_idx";

-- CreateIndex
CREATE INDEX "EnvRule_sourceId_target_priority_idx" ON "EnvRule"("sourceId", "target", "priority");
