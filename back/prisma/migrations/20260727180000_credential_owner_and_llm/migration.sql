-- CreateEnum
CREATE TYPE "CredentialOwner" AS ENUM ('source', 'llmProvider');

-- CreateEnum
CREATE TYPE "LlmKind" AS ENUM ('anthropic', 'openai', 'google', 'mistral');

-- AlterTable: Credential stops belonging to a source and starts naming its owner.
ALTER TABLE "Credential" ADD COLUMN "ownerType" "CredentialOwner";
ALTER TABLE "Credential" ADD COLUMN "ownerId" TEXT;

-- Every row that exists today is a source credential.
UPDATE "Credential" SET "ownerType" = 'source', "ownerId" = "sourceId";

ALTER TABLE "Credential" ALTER COLUMN "ownerType" SET NOT NULL;
ALTER TABLE "Credential" ALTER COLUMN "ownerId" SET NOT NULL;

-- The foreign key goes with the column: an owner is no longer always a source,
-- so the cascade is replaced by an explicit delete in the owning service.
ALTER TABLE "Credential" DROP CONSTRAINT "Credential_sourceId_fkey";
DROP INDEX "Credential_sourceId_key";
ALTER TABLE "Credential" DROP COLUMN "sourceId";

-- CreateIndex
CREATE UNIQUE INDEX "Credential_ownerType_ownerId_key" ON "Credential"("ownerType", "ownerId");

-- CreateTable
CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LlmKind" NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);
