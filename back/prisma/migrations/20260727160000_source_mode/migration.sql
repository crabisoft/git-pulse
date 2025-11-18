-- CreateEnum
CREATE TYPE "SourceMode" AS ENUM ('live', 'stored');

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "mode" "SourceMode" NOT NULL DEFAULT 'live';
