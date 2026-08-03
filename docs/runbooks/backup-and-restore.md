# Backup and restore

**Read this before you need it.** An install is two things that have to be
backed up together, and backing up only the obvious one leaves you with a
database whose credentials nobody can read.

| What | Where | Why it matters |
|---|---|---|
| The database | the `db-data` volume | Everything: sources, accounts, the store, the metric history, the changelog archive |
| The master key | the `master-key` volume, `/data/master.key` | Decrypts every stored credential. A restore without it restores unreadable secrets |

Only the changelog archive is genuinely irreplaceable — every other table can be
rebuilt from the platforms, given time and API budget. The archive cannot: it
holds what deployments carried after the platform stopped being able to say.

## Backing up

Both, in one pass, with the stack running:

```bash
mkdir -p backup
$C exec -T db pg_dump -U dashboard --format=custom dashboard > backup/dashboard.dump
$C exec -T back cat /data/master.key > backup/master.key
chmod 600 backup/master.key
```

From a clone, the same block with a target: `make backup` (add
`mode=prod` for the production stack, `out=/somewhere/else` to write elsewhere
than `backup/`). It writes the same two file names, which is what the restore
below expects.

`pg_dump` runs against a live database and takes a consistent snapshot; there is
no need to stop anything. Adjust `-U dashboard` and the database name if
`POSTGRES_USER` or `POSTGRES_DB` were changed.

**Store the key apart from the dump.** Keeping them in the same place means one
leak hands over both the ciphertext and the key that opens it — which is the
same as storing the tokens in clear.

Schedule it as you schedule anything else; nothing in the application is aware
of the backup, and nothing needs to be.

## Restoring

Onto an empty install:

```bash
$C up -d db
# Wait for it to be ready, then load the dump into a fresh database.
$C exec -T db pg_restore -U dashboard -d dashboard --clean --if-exists < backup/dashboard.dump

# The key, before the API starts — it is read once, on boot.
$C run --rm -T back sh -c 'cat > /data/master.key && chmod 600 /data/master.key' < backup/master.key

$C up -d
```

From a clone, the same block with a target: `make restore` (it reads the two
file names `make backup` wrote, from `backup/` unless `in=/somewhere/else` says
otherwise; add `mode=prod` for the production stack). It asks before replacing
the database — `yes=1` skips the question for a script — waits for Postgres to
accept connections before loading, and reports a missing `master.key` rather
than refusing: that is the case below, not a failure.

Then check that a credential is actually readable: open **Settings › Sources**
and press **Test** on a source. That call decrypts the token and spends it —
which is exactly what proves the key matches the data.

## Restoring without the key

The database is fine and every encrypted column is not. What survives: sources,
accounts, the whole store, the metric history, the changelog archive. What does
not: the platform tokens, the webhook secrets and the model API keys.

There is no way to recover them, and no need to restore anything else. Let the
API generate a new key on boot, then re-enter each secret from **Settings**:
each source's credential, each model provider's key, and a new webhook secret
per source, which has to be declared on the platform side again.

See [the master key](master-key.md) for the same procedure written out.

## What this does not cover

- **Point-in-time recovery.** `pg_dump` gives you the moment it ran. If the
  install matters that much, run Postgres somewhere that does WAL archiving and
  treat this page as being about the key only.
- **Redis.** Nothing there needs backing up: it holds jobs in flight, and the
  schedule is re-registered from the settings on boot. A lost queue costs one
  collection cycle.
