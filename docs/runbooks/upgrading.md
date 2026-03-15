# Upgrading

The API applies pending migrations when it starts — `prisma migrate deploy`,
non-interactive and idempotent, in every stack. An upgrade is therefore a pull
and a restart, with one thing to know: **migrations do not roll back.**

## Before

```bash
$C exec -T db pg_dump -U dashboard --format=custom dashboard > backup/before-upgrade.dump
```

That is the rollback plan. There is no other one — Prisma migrations have no
down step, so a version that changes a column cannot be un-applied by going back
to the previous image. Going back means restoring this dump.

Read the release notes for the version you are moving to before starting, and
check whether anything is said about a new environment variable or a manual
step.

## Upgrading

From the published images:

```bash
$C pull
$C up -d
$C logs -f back
```

Watch the logs until the API reports it is listening. What you should see, in
order: the master key being loaded, the migrations applying (or nothing at all
if there were none), then `API ready on …`.

From a clone, the same with a build first:

```bash
git pull
make prod           # rebuilds the images and restarts
```

## After

1. **Sign in.** A session survives a restart — they live in the database — so
   being asked to sign in again means the sessions table was touched, which is
   worth noting but not alarming.
2. **Open the overview.** The `queues` badge tells you Redis is answering and
   the collection is running.
3. **Press Test on one source.** It proves the master key is still readable by
   this version, which is the only failure that would be silent otherwise.
4. **Look at Settings › Background jobs** an hour later: a collection that
   started failing after an upgrade shows there, with the platform's own
   message.

## When the migration fails

The API will not start, and the logs name the migration. Do not restart it in a
loop: `migrate deploy` is idempotent but a half-applied migration is a state it
refuses to guess about.

```bash
$C logs back | tail -40          # which migration, and what the database said
```

Then restore the dump you took above onto the previous image, and open an issue
with the migration name and the error. The two situations that produce this are
a database modified by hand and a version skipped in a chain that expected it.

## Downgrading

Restore the dump onto the previous image. Nothing else works, and running an
older API against a newer schema is not something to try — Prisma will refuse
where it can, and where it cannot the columns it does not know about are the
ones the new version writes.
