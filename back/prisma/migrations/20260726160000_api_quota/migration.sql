-- CreateEnum
CREATE TYPE "QuotaSubject" AS ENUM ('source', 'tracker');

-- CreateEnum
CREATE TYPE "QuotaOrigin" AS ENUM ('observed', 'declared');

-- CreateTable
CREATE TABLE "ApiQuota" (
    "id" TEXT NOT NULL,
    "subjectKind" "QuotaSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "used" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "windowSec" INTEGER,
    "origin" "QuotaOrigin" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuota_subjectKind_subjectId_bucket_key" ON "ApiQuota"("subjectKind", "subjectId", "bucket");
