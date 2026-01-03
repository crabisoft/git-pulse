-- A deployment filed without contents: the platform would not resolve its refs
-- when the archiver reached it. Recorded rather than retried — a 404 on a
-- compare does not become false again, and retrying for ever would hold the
-- batch against the deployments that can still be read.
ALTER TABLE "DeploymentChangelog" ADD COLUMN "unreadable" BOOLEAN NOT NULL DEFAULT false;
