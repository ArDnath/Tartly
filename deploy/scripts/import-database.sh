#!/usr/bin/env bash
#
# One-time cutover from the existing managed Postgres (Neon) to the local
# cluster. Preserves user rows and — critically — the OAuth tokens encrypted
# with BETTER_AUTH_SECRET, which must stay identical in app.env.
#
#   SOURCE_DATABASE_URL='postgresql://...' ./scripts/import-database.sh
#
# Safe to re-run: it truncates by restoring with --clean.
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

SRC="${SOURCE_DATABASE_URL:?set SOURCE_DATABASE_URL to the current database URL}"
COMPOSE=(docker compose --env-file .env)

echo "!! This replaces the local 'tartly' database with a copy of the source."
read -r -p "Type 'import' to continue: " answer
[[ "$answer" == "import" ]] || { echo "aborted"; exit 1; }

echo "==> stopping app"
"${COMPOSE[@]}" stop web-1 web-2 worker || true

TMP=$(mktemp /tmp/tartly-import-XXXXXX.dump)
trap 'rm -f "$TMP"' EXIT

echo "==> dumping source"
"${COMPOSE[@]}" exec -T postgres pg_dump "$SRC" \
  --format=custom --compress=0 --no-owner --no-acl >"$TMP"
echo "  $(du -h "$TMP" | cut -f1)"

echo "==> terminating local connections"
"${COMPOSE[@]}" exec -T postgres psql -U tartly -d postgres -v ON_ERROR_STOP=1 -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname='tartly' and pid <> pg_backend_pid();" >/dev/null

echo "==> restoring locally"
"${COMPOSE[@]}" exec -T postgres pg_restore -U tartly -d tartly \
  --clean --if-exists --no-owner --no-acl --single-transaction <"$TMP"

echo "==> migrations"
"${COMPOSE[@]}" run --rm --no-deps worker npm run db:migrate

echo "==> row counts"
"${COMPOSE[@]}" exec -T postgres psql -U tartly -d tartly -c \
  "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 15;"

echo "==> starting app"
"${COMPOSE[@]}" start web-1 web-2 worker

cat <<'EOF'

Import complete.

Keep in mind:
  - BETTER_AUTH_SECRET must match the old deployment, or stored OAuth refresh
    tokens cannot be decrypted (users would have to reconnect Gmail).
  - Better Auth sessions in the old Upstash Redis were not migrated; users
    will sign in again. That is expected.
EOF
