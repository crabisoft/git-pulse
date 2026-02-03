-- The source a reader lands on when the address names none. At most one, which
-- the service enforces on every write; false everywhere to begin with, so an
-- install keeps opening on the first source exactly as it did.
ALTER TABLE "Source" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
