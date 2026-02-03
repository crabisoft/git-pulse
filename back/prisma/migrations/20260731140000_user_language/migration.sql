-- The language an account reads in. Nullable on purpose: null follows the
-- browser, which is a better guess for somebody who never chose than any
-- default stored here would be.
ALTER TABLE "User" ADD COLUMN "language" TEXT;
