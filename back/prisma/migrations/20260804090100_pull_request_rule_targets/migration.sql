-- Two targets whose subject is the pull request itself rather than the repo
-- holding it: each of its labels, and its title. A repo name classifies every
-- request of a monorepo the same way, which is to say not at all.
--
-- Added, never removed: an existing rule keeps the target it was saved with.
--
-- Safe inside the transaction Prisma wraps a migration in: PostgreSQL only
-- refuses a value added and *used* in the same transaction, and nothing here
-- writes a row carrying one.
ALTER TYPE "RuleTarget" ADD VALUE IF NOT EXISTS 'pull_request';
ALTER TYPE "RuleTarget" ADD VALUE IF NOT EXISTS 'pull_request_title';
