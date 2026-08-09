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

# `/api/auth/me` rather than a dashboard route: it is the one endpoint that
# answers before there is a session — `@Anonymous()` — and it still reads the
# settings and counts the users, so a 200 means the client constructed and the
# database replied. A route under `/api/overview` would need a source id, and a
# seeded database is a second thing to keep true.
#
# Three outcomes, deliberately: nothing listening yet is worth waiting for, a
# wrong status never becomes a right one, and a process that died says so now
# rather than in a minute.
echo "→ Waiting for /api/auth/me"
i=0
until node -e "
  fetch('http://localhost:${API_PORT}/api/auth/me').then(
    (r) => {
      if (!r.ok) console.error('Answered ' + r.status + ' where 200 was expected.');
      process.exit(r.ok ? 0 : 2);
    },
    () => process.exit(1),
  );
"; do
  test $? -eq 1 || exit 1
  i=$((i + 1))
  kill -0 "$api" 2>/dev/null || { echo "The API exited before it answered."; exit 1; }
  test "$i" -lt 60 || { echo "The API never answered on port ${API_PORT}."; exit 1; }
  sleep 1
done

echo "✓ The API booted and answered."
