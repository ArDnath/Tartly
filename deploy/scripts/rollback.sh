#!/usr/bin/env bash
#
# Re-point web + worker at the previous release (no rebuild, no migrations).
#
# The pointers are swapped, not overwritten: running this script twice returns
# to the tag you started from (useful for a controlled rollback drill).
#
# Database migrations are forward-only and are NOT undone. If a release
# included a destructive migration, restore the pre-deploy dump instead (see
# deploy/RUNBOOK.md).
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env -f docker-compose.yml)

die() { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

read_pointer() { cat ".deploy/$1" 2>/dev/null || true; }
CURRENT_TAG="$(read_pointer current-tag)"
TARGET_TAG="$(read_pointer previous-tag)"
CURRENT_WEB_IMAGE="$(read_pointer current-web-image)"
CURRENT_WORKER_IMAGE="$(read_pointer current-worker-image)"
TARGET_WEB_IMAGE="$(read_pointer previous-web-image)"
TARGET_WORKER_IMAGE="$(read_pointer previous-worker-image)"

[[ -n "$TARGET_TAG" ]] || die "no previous tag recorded"
[[ "$TARGET_TAG" != "$CURRENT_TAG" ]] || die "already on ${TARGET_TAG}; nothing to roll back"
[[ -n "$TARGET_WEB_IMAGE" ]] || TARGET_WEB_IMAGE="tartly-web:${TARGET_TAG}"
[[ -n "$TARGET_WORKER_IMAGE" ]] || TARGET_WORKER_IMAGE="tartly-worker:${TARGET_TAG}"
[[ -n "$CURRENT_WEB_IMAGE" ]] || CURRENT_WEB_IMAGE="tartly-web:${CURRENT_TAG}"
[[ -n "$CURRENT_WORKER_IMAGE" ]] || CURRENT_WORKER_IMAGE="tartly-worker:${CURRENT_TAG}"

echo "==> rolling back ${CURRENT_TAG:-unknown} -> ${TARGET_TAG}"

# The previous image is normally still local. If it was pruned (or this is a
# different host), try the registry and fail loudly rather than starting a
# stale image.
for image in "$TARGET_WEB_IMAGE" "$TARGET_WORKER_IMAGE"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "==> pulling ${image}"
    docker pull "$image" || die "previous image is not available locally or in the registry: ${image}"
  fi
done

TAG="$TARGET_TAG" WEB_IMAGE="$TARGET_WEB_IMAGE" WORKER_IMAGE="$TARGET_WORKER_IMAGE" \
  "${COMPOSE[@]}" up -d --no-deps --force-recreate web-1 web-2 worker

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

set -a
# shellcheck disable=SC1091
. ./.env
set +a
PUBLIC_URL="${PUBLIC_URL:?PUBLIC_URL missing from deploy/.env}"
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "${PUBLIC_URL%/}/api/health/ready" >/dev/null; then
    echo "  ${PUBLIC_URL} is ready"
    ready=1
    break
  fi
  sleep 2
done
(( ready == 1 )) || die "${PUBLIC_URL}/api/health/ready never returned 200 after rollback"

# Swap the pointers so the next run returns to the release we just left.
[[ -n "$CURRENT_TAG" ]] && printf '%s\n' "$CURRENT_TAG" >.deploy/previous-tag
[[ -n "$CURRENT_WEB_IMAGE" ]] && printf '%s\n' "$CURRENT_WEB_IMAGE" >.deploy/previous-web-image
[[ -n "$CURRENT_WORKER_IMAGE" ]] && printf '%s\n' "$CURRENT_WORKER_IMAGE" >.deploy/previous-worker-image
printf '%s\n' "$TARGET_TAG" >.deploy/current-tag
printf '%s\n' "$TARGET_WEB_IMAGE" >.deploy/current-web-image
printf '%s\n' "$TARGET_WORKER_IMAGE" >.deploy/current-worker-image

set_env_var() {
  local key=$1 value=$2
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >>.env
  fi
}
set_env_var TAG "$TARGET_TAG"
set_env_var WEB_IMAGE "$TARGET_WEB_IMAGE"
set_env_var WORKER_IMAGE "$TARGET_WORKER_IMAGE"
chmod 600 .env 2>/dev/null || true

"${COMPOSE[@]}" ps
echo "==> rolled back to ${TARGET_TAG}"
