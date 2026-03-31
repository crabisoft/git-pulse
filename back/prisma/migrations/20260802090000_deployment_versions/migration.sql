-- CreateTable
CREATE TABLE "DeploymentVersion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "ruleId" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL,
    "error" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "delaySec" INTEGER NOT NULL,

    CONSTRAINT "DeploymentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentVersion_sourceId_deploymentId_key" ON "DeploymentVersion"("sourceId", "deploymentId");

-- CreateIndex
CREATE INDEX "DeploymentVersion_sourceId_deployedAt_idx" ON "DeploymentVersion"("sourceId", "deployedAt");

-- CreateIndex
CREATE INDEX "DeploymentVersion_ruleId_idx" ON "DeploymentVersion"("ruleId");

-- AddForeignKey
ALTER TABLE "DeploymentVersion" ADD CONSTRAINT "DeploymentVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVersion" ADD CONSTRAINT "DeploymentVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "VersionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
