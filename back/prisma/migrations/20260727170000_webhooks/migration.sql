-- AlterTable
ALTER TABLE "Source" ADD COLUMN "webhooksEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WebhookSecret" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSecret_sourceId_key" ON "WebhookSecret"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_sourceId_deliveryId_key" ON "WebhookDelivery"("sourceId", "deliveryId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_sourceId_receivedAt_idx" ON "WebhookDelivery"("sourceId", "receivedAt");

-- AddForeignKey
ALTER TABLE "WebhookSecret" ADD CONSTRAINT "WebhookSecret_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
