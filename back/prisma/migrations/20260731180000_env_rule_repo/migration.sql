-- The repo a rule is confined to. Generic environment names are the reason:
-- `Prod` says nothing on its own, and what it deploys is only knowable from the
-- repo it was seen in. Null everywhere to begin with — a rule that names no
-- repo applies to all of them, as every existing rule does.
ALTER TABLE "EnvRule" ADD COLUMN "repo" TEXT;
