-- CreateTable
CREATE TABLE "ApiBudget" (
    "id" TEXT NOT NULL,
    "subjectKind" "QuotaSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "windowSec" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiBudget_subjectKind_subjectId_key" ON "ApiBudget"("subjectKind", "subjectId");
