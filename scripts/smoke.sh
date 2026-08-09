#!/usr/bin/env sh
# Boots the API against a real database. Runs inside the `checks` container —
# `make smoke` — and the CI runs that same target.
#
# What it covers that no unit suite can: the migrations apply in order on an
# empty database, the schema and those migrations still describe the same
# tables, and a client actually constructs, connects and answers. Every spec in
# the repo mocks Prisma, so nothing else here ever opens a connection — which is
# how a dependency bump can leave the whole suite green and the container dead.
#
# DATABASE_URL, SHADOW_DATABASE_URL, REDIS_URL and API_PORT come from the
# service definition in .docker/docker-compose.dev.yml. The database is one of
# its own, created and dropped by the Makefile around this script.
set -eu

echo "→ Applying the migrations"
npm run prisma:deploy -w @repo/back

# A schema edited without a migration is a column that exists on one machine and
# nowhere else. --exit-code turns "they differ" into a failure rather than a
# report nobody reads.
echo "→ Checking that the schema and the migrations agree"
npx prisma migrate diff \
  --from-migrations back/prisma/migrations \
  --to-schema-datamodel back/prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code

echo "→ Building the API"
npm run build:shared
npm run build -w @repo/back

echo "→ Starting it"
node back/dist/main.js &
api=$!
trap 'kill "$api" 2>/dev/null || true' EXIT

# The dashboard is public by default, so this needs no session. That it answers
# at all is the point: the process booted, the client constructed, the database
# and Redis replied.
echo "→ Waiting for /api/overview"
i=0
until node -e "fetch('http://localhost:${API_PORT}/api/overview').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  # A process that died is not a slow start: say so now rather than in 60s.
  kill -0 "$api" 2>/dev/null || { echo "The API exited before it answered."; exit 1; }
  test "$i" -lt 60 || { echo "The API never answered on port ${API_PORT}."; exit 1; }
  sleep 1
done

echo "✓ The API booted and answered."
