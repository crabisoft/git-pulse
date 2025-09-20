-- Run once, by hand, on a dev database that already applied the rewritten
-- migration `20260726140000_ticket_rules`. That directory no longer exists:
-- its content was folded into `20260726150000_trackers`, which now creates
-- `TicketRule` in a different shape.
--
-- Two things therefore have to be undone: the objects the old migration left
-- behind, and the two bookkeeping rows that make `prisma migrate deploy`
-- refuse to move — one for a migration whose directory is gone, one for the
-- new migration if it already failed halfway.
--
--   make psql   then   \i /path/to/this/file
--   or: docker compose ... exec -T db psql -U dashboard dashboard < this-file
--
-- DESTRUCTIVE, but only for ticket rules: any rule created while testing is
-- dropped. They could not survive anyway — the new table requires a trackerId
-- that no tracker exists to satisfy. Sources, credentials, classification
-- rules, settings and metric snapshots are untouched.

BEGIN;

-- Objects from the old migration. CASCADE takes the index and the foreign key
-- with the table; the enum has to go after it, being a column type.
DROP TABLE IF EXISTS "TicketRule" CASCADE;
DROP TYPE IF EXISTS "TicketTracker";

-- Objects from the new migration, in case it applied partway before failing.
-- Dropping them is safe: `migrate deploy` recreates the whole set.
DROP TABLE IF EXISTS "SourceTracker" CASCADE;
DROP TABLE IF EXISTS "Tracker" CASCADE;
DROP TYPE IF EXISTS "TrackerKind";

-- Forget both attempts. Everything else in _prisma_migrations stays, so the
-- migrations before these are not replayed.
DELETE FROM "_prisma_migrations"
 WHERE migration_name IN ('20260726140000_ticket_rules', '20260726150000_trackers');

COMMIT;

-- Check before leaving psql: the three tables and two enums must be gone, and
-- the last applied migration must be 20260726120000_rule_target_incident.
--
--   \dt "Tracker"|"SourceTracker"|"TicketRule"
--   SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at;
