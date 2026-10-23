#!/usr/bin/env bash
#
# Re-point web + worker at the previous image tag (no rebuild).
# Database migrations are forward-only and are NOT undone.
#
# The pointers are swapped, not overwritten: running this script twice returns
# to the tag you started from (useful for a controlled rollback drill).
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env)

die() { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

CURRENT=$(cat .deploy/current-tag 2>/dev/null || true)
TARGET=$(cat .deploy/previous-tag 2>/dev/null || true)
[[ -n "$TARGET" ]] || die "no previous tag recorded"
[[ "$TARGET" != "$CURRENT" ]] || die "already on ${TARGET}; nothing to roll back"

echo "==> rolling back ${CURRENT:-unknown} -> ${TARGET}"
# Keep manual `docker compose` commands on the rolled-back image too.
if grep -q '^TAG=' .env; then
  sed -i "s|^TAG=.*|TAG=${TARGET}|" .env
else
  printf '\nTAG=%s\n' "$TARGET" >>.env
fi

TAG="$TARGET" "${COMPOSE[@]}" up -d --no-deps --force-recreate web-1 web-2 worker

wait_healthy() {
  local service=$1 id status
  id=$("${COMPOSE[@]}" ps -q "$service")
  [[ -n "$id" ]] || die "${service}: no container"
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
    case "$status" in
      healthy) echo "  ${service}: healthy"; return 0 ;;
      unhealthy) docker logs --tail 50 "$id" >&2; die "${service}: unhealthy" ;;
    esac
    sleep 2
  done
  docker logs --tail 80 "$id" >&2
  die "${service}: did not become healthy in 120s"
}

wait_healthy web-1
wait_healthy web-2

# Swap the pointers so the next run returns to the tag we just left.
[[ -n "$CURRENT" ]] && echo "$CURRENT" >.deploy/previous-tag
echo "$TARGET" >.deploy/current-tag

PUBLIC_URL=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- | tr -d '"')
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready" >/dev/null; then
    echo "  ${PUBLIC_URL} is ready"
    ready=1
    break
  fi
  sleep 2
done
(( ready == 1 )) || die "${PUBLIC_URL}/api/health/ready never returned 200 after rollback"

"${COMPOSE[@]}" ps
echo "==> rolled back to ${TARGET}"
