#!/usr/bin/env sh
# docker compose wrapper.
#   Usage: ./.docker/compose.sh <dev|prod> <compose args...>
#   e.g.:  ./.docker/compose.sh dev up
#          ./.docker/compose.sh prod up --build
#
# Loads .docker/.env, then .docker/.env.local on top if present (override),
# and combines the base file with the chosen mode's override.
set -ex
DIR="$(cd "$(dirname "$0")" && pwd)"

MODE="${1:-dev}"
if [ "$#" -gt 0 ]; then shift; fi

case "$MODE" in
  dev)  OVERRIDE="$DIR/docker-compose.dev.yml" ;;
  prod) OVERRIDE="$DIR/docker-compose.prod.yml" ;;
  *)
    echo "Mode inconnu : '$MODE' (attendu : dev | prod)" >&2
    exit 1
    ;;
esac

ENV_ARGS="--env-file $DIR/.env"
if [ -f "$DIR/.env.local" ]; then
  ENV_ARGS="$ENV_ARGS --env-file $DIR/.env.local"
fi

exec docker compose $ENV_ARGS \
  -f "$DIR/docker-compose.yml" \
  -f "$OVERRIDE" \
  "$@"
