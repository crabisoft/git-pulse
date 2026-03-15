# Runbooks

What to do when something has gone wrong, or when something has to be done
carefully. One file per situation, each written to be read while it is
happening — the symptom first, then what is actually going on, then the steps.

The [technical documentation](../technical/) explains how the thing works.
These explain what to do about it.

| Runbook | Read it when |
|---|---|
| [Backup and restore](backup-and-restore.md) | Before you need it. Two volumes, and one of them is not the database |
| [Upgrading](upgrading.md) | A new version is out, and migrations run on start |
| [The master key](master-key.md) | It is lost, leaked, or the install is moving host |
| [Nobody can sign in](lost-admin-access.md) | The last admin is gone or locked out |
| [Nothing is being collected](collection-stalled.md) | The pages still work, and the data has stopped moving |
| [The API budget is spent](api-quota-exhausted.md) | Collections fail, or metrics thin out on their own |
| [Webhooks are not arriving](webhooks-not-arriving.md) | Deliveries are accepted and nothing changes, or nothing arrives at all |
| [Disk and retention](disk-and-retention.md) | The database is growing, and one table never stops |

## Addressing your stack

Every command below runs against a compose stack, which is invoked differently
depending on how the install was started. Pick your line once:

```bash
# Published images (docker-compose.ghcr.yml)
C="docker compose -f docker-compose.ghcr.yml"

# Locally built production stack (the repository's prod mode)
C="sh .docker/compose.sh prod"

# Development stack
C="sh .docker/compose.sh dev"
```

The runbooks then say `$C exec back …`, and the service names are the same in
all three: `db`, `redis`, `back`, `front`.

## A note on what these assume

- The API applies pending migrations when it starts, in every stack.
- The database holds everything except the master key, which lives in its own
  volume and is what makes the database's encrypted columns readable at all.
- Nothing here needs the application to be reachable. Every step is a container
  command, on purpose: the situations that need a runbook are the ones where the
  UI is not an option.
