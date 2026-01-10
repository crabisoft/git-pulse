-- What an account chose for itself: which overview it reads, and on which
-- ground. Nullable on purpose — null means "follow the installation default",
-- which a copy of that default would stop doing the day it changes.
ALTER TABLE "User" ADD COLUMN "displayDirection" TEXT;
ALTER TABLE "User" ADD COLUMN "displayMode" TEXT;
