#!/usr/bin/env bash
#
# Restore a custom-format dump produced by backup-postgres.sh.
#
#   ./scripts/restore-postgres.sh /var/backups/tartly/tartly-20261023T021500Z.dump.zst
#
# DESTRUCTIVE: drops and recreates every object in the `tartly` database.
# The app is stopped for the duration, then started again.
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: restore-postgres.sh <dump.zst>}"
[[ -f "$FILE" ]] || { echo "not found: $FILE" >&2; exit 1; }
COMPOSE=(docker compose --env-file .env)

if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "Restore ${FILE} over the live database? Type 'restore' to continue: " answer
  [[ "$answer" == "restore" ]] || { echo "aborted"; exit 1; }
fi

echo "==> stopping app"
"${COMPOSE[@]}" stop web-1 web-2 worker

cleanup() { echo "==> starting app"; "${COMPOSE[@]}" start web-1 web-2 worker; }
trap cleanup EXIT

echo "==> dropping connections"
"${COMPOSE[@]}" exec -T postgres psql -U tartly -d postgres -v ON_ERROR_STOP=1 -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname='tartly' and pid <> pg_backend_pid();" >/dev/null

echo "==> restoring"
zstd -dc "$FILE" | "${COMPOSE[@]}" exec -T postgres \
  pg_restore -U tartly -d tartly --clean --if-exists --no-owner --no-acl --single-transaction

echo "==> analyzing"
"${COMPOSE[@]}" exec -T postgres psql -U tartly -d tartly -c "analyze;" >/dev/null

echo "==> migrations (catch up any schema drift)"
"${COMPOSE[@]}" run --rm --no-deps worker npm run db:migrate

echo "==> restore complete"
