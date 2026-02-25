-- Attributes a rule forces when its pattern matches. A named group can only
-- capture text the name already holds, so a name that never spells out its
-- application could not be given one. Null everywhere to begin with: a rule
-- that only captures behaves exactly as before.
ALTER TABLE "EnvRule" ADD COLUMN "attributes" JSONB;
