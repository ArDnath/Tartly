#!/usr/bin/env bash
#
# Re-point web + worker at the previous image tag (no rebuild).
# Database migrations are forward-only and are NOT undone.
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

[[ -f .deploy/previous-tag ]] || { echo "no previous tag recorded" >&2; exit 1; }
TAG=$(cat .deploy/previous-tag)
export TAG
COMPOSE=(docker compose --env-file .env)

echo "==> rolling back to ${TAG}"
"${COMPOSE[@]}" up -d --no-deps web-1 web-2 worker
"${COMPOSE[@]}" ps

mv .deploy/current-tag .deploy/failed-tag 2>/dev/null || true
echo "$TAG" >.deploy/current-tag
