-- CreateEnum
CREATE TYPE "TrackerKind" AS ENUM ('jira', 'linear', 'github', 'gitlab');

-- CreateTable
CREATE TABLE "Tracker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TrackerKind" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "urlTemplate" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tracker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tracker_slug_key" ON "Tracker"("slug");

-- CreateTable
CREATE TABLE "SourceTracker" (
    "sourceId" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "incidents" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceTracker_pkey" PRIMARY KEY ("sourceId", "trackerId")
);

-- CreateIndex
CREATE INDEX "SourceTracker_trackerId_idx" ON "SourceTracker"("trackerId");

-- CreateTable
CREATE TABLE "TicketRule" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketRule_trackerId_priority_idx" ON "TicketRule"("trackerId", "priority");

-- AddForeignKey
ALTER TABLE "SourceTracker" ADD CONSTRAINT "SourceTracker_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceTracker" ADD CONSTRAINT "SourceTracker_trackerId_fkey"
    FOREIGN KEY ("trackerId") REFERENCES "Tracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketRule" ADD CONSTRAINT "TicketRule_trackerId_fkey"
    FOREIGN KEY ("trackerId") REFERENCES "Tracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

