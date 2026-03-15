# The master key

One 32-byte key encrypts every secret the install holds: the platform tokens,
the webhook secrets, the model API keys. It is generated on first boot into
`MASTER_KEY_FILE` (`/data/master.key`, mode `0600`, on its own volume), or read
from `MASTER_KEY` as base64 when a secret manager supplies it.

Everything below follows from one fact: **the application can rewrite a secret,
and cannot recover one.**

## It was lost

The database is intact, the key is gone. Every encrypted column is now noise.

There is nothing to recover and nothing to repair — only to re-enter:

1. Let the API generate a new key. Start it with an empty `master-key` volume;
   it writes one and logs `No master key found: a new one was generated …`.
2. **Settings › Sources** — open each source and give it its credential again.
   Press **Test**: it decrypts and spends the token, which is what proves the
   new key is in use.
3. **Settings › Sources › webhooks** — issue a new secret per source that had
   one, and declare it on the platform side. The old secret is unreadable to
   this install, so deliveries signed with it are rejected.
4. **Settings › AI providers** — re-enter each API key.

Nothing else is affected. The store, the metric history, the changelog archive
and the accounts are not encrypted and were never at risk.

## It may have leaked

Treat it as every source token having leaked, because that is what it means. In
order:

1. **Revoke the tokens at the platform**, not here. A leaked key plus a database
   dump gives the holder your GitHub and GitLab credentials; changing what this
   install stores does nothing about a copy already taken.
2. Issue new tokens, and enter them here.
3. Replace the key itself by treating it as lost, above — generate a new one and
   re-enter the secrets, which is what re-encrypts them.

**There is no rotation command.** Re-encrypting in place would need both keys at
once and a pass over every stored secret; the code carries a key version for the
day that exists, and until then the honest procedure is the one above.

## Moving the install to another host

Both volumes travel together, or the destination restores unreadable secrets:

```bash
$C exec -T db pg_dump -U dashboard --format=custom dashboard > dashboard.dump
$C exec -T back cat /data/master.key > master.key
```

Copy both, then follow [backup and restore](backup-and-restore.md). Carry the
key over a channel you would carry a production password over — it is one.

## Supplying it from a secret manager

`MASTER_KEY` takes precedence over the file and expects base64 of exactly 32
bytes. Generate one with:

```bash
openssl rand -base64 32
```

A value of the wrong length fails at boot with a message saying how many bytes
were decoded, rather than starting and writing secrets nothing can read back.

With `MASTER_KEY` set, the `master-key` volume is unused — back up whatever your
secret manager stores instead, and remember that it now has to be in the backup
plan.
