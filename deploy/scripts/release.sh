#!/usr/bin/env bash
#
# Deploy already-built images to the production stack.
#
#   TAG=sha-<commit> \
#   WEB_IMAGE=ghcr.io/owner/repo-web:sha-<commit> \
#   WORKER_IMAGE=ghcr.io/owner/repo-worker:sha-<commit> \
#   bash deploy/scripts/release.sh
#
# This is used by the GitHub "Deploy production" workflow. Set SKIP_PULL=1 when
# the images were just built locally by deploy.sh.
#
# Safety properties:
#   - one release at a time (flock), never two migrations racing
#   - a pre-migration dump is taken by default (SKIP_PRE_DEPLOY_BACKUP=1 opts out)
#   - web replicas roll one at a time behind Caddy's health checks
#   - the previous image pointers are only updated after the public readiness
#     probe passes, and an error after the first container is replaced triggers
#     an automatic rollback to the previous images
#
# Migrations remain forward-only: a rollback restores the app image, not the
# schema. A destructive migration therefore still requires the pre-deploy dump.
#
set -Eeuo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env -f docker-compose.yml)

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

# Keep the values passed by CI/manual invocation: sourcing `.env` below must
# not replace them with the previously deployed tag.
RELEASE_TAG="${TAG:-}"
RELEASE_WEB_IMAGE="${WEB_IMAGE:-}"
RELEASE_WORKER_IMAGE="${WORKER_IMAGE:-}"

TAG="$RELEASE_TAG"
WEB_IMAGE="$RELEASE_WEB_IMAGE"
WORKER_IMAGE="$RELEASE_WORKER_IMAGE"
[[ -n "$TAG" ]] || die "TAG is required (for example TAG=sha-<commit>)"
[[ -n "$WEB_IMAGE" ]] || die "WEB_IMAGE is required"
[[ -n "$WORKER_IMAGE" ]] || die "WORKER_IMAGE is required"
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "TAG contains unexpected characters: ${TAG}"
[[ "$WEB_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] || die "WEB_IMAGE contains unexpected characters"
[[ "$WORKER_IMAGE" =~ ^[A-Za-z0-9._/:@+-]+$ ]] || die "WORKER_IMAGE contains unexpected characters"
export TAG WEB_IMAGE WORKER_IMAGE

log "Preflight"
[[ -f .env ]] || die "deploy/.env missing — run: node deploy/scripts/render-env.mjs (on your workstation) then copy it here"
[[ -f app.env ]] || die "deploy/app.env missing — render it on your workstation and scp it here"
[[ $(stat -c '%a' app.env) == "600" ]] || warn "app.env permissions are $(stat -c '%a' app.env) (expected 600)"
command -v docker >/dev/null || die "docker not installed — run bootstrap.sh first"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is the user in the docker group?)"
command -v flock >/dev/null || die "flock is required (install util-linux)"

set -a
# shellcheck disable=SC1091
. ./.env
set +a
[[ -n "${PUBLIC_URL:-}" ]] || die "PUBLIC_URL missing from deploy/.env"

# Restore the release values (`.env` may carry the previous TAG/IMAGE lines).
TAG="$RELEASE_TAG"
WEB_IMAGE="$RELEASE_WEB_IMAGE"
WORKER_IMAGE="$RELEASE_WORKER_IMAGE"
export TAG WEB_IMAGE WORKER_IMAGE

mkdir -p .deploy
exec 9>.deploy/deploy.lock
flock -n 9 || die "another release is already running (deploy/.deploy/deploy.lock)"

read_pointer() { cat ".deploy/$1" 2>/dev/null || true; }
PREV_TAG="$(read_pointer current-tag)"
PREV_WEB_IMAGE="$(read_pointer current-web-image)"
PREV_WORKER_IMAGE="$(read_pointer current-worker-image)"
if [[ -z "$PREV_WEB_IMAGE" && -n "$PREV_TAG" ]]; then
  PREV_WEB_IMAGE="tartly-web:${PREV_TAG}"
fi
if [[ -z "$PREV_WORKER_IMAGE" && -n "$PREV_TAG" ]]; then
  PREV_WORKER_IMAGE="tartly-worker:${PREV_TAG}"
fi

wait_healthy() {
  local service=$1 id status
  id=$("${COMPOSE[@]}" ps -q "$service")
  if [[ -z "$id" ]]; then
    warn "${service}: no container"
    return 1
  fi
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
    case "$status" in
      healthy) echo "  ${service}: healthy"; return 0 ;;
      unhealthy)
        docker logs --tail 50 "$id" >&2
        warn "${service}: unhealthy"
        return 1
        ;;
    esac
    sleep 2
  done
  docker logs --tail 80 "$id" >&2
  warn "${service}: did not become healthy in 120s"
  return 1
}

wait_running() {
  local service=$1 id status
  id=$("${COMPOSE[@]}" ps -q "$service")
  if [[ -z "$id" ]]; then
    warn "${service}: no container"
    return 1
  fi
  for _ in $(seq 1 30); do
    status=$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || true)
    if [[ "$status" == "running" ]]; then
      echo "  ${service}: running"
      return 0
    fi
    sleep 2
  done
  docker logs --tail 80 "$id" >&2 || true
  warn "${service}: not running"
  return 1
}

verify_public() {
  local url="${PUBLIC_URL%/}/api/health/ready"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 10 "$url" >/dev/null; then
      echo "  ${url} is ready"
      return 0
    fi
    sleep 2
  done
  warn "${url} never returned 200"
  return 1
}

set_env_var() {
  local key=$1 value=$2
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >>.env
  fi
}

rollback_previous() {
  if [[ -z "$PREV_TAG" ]]; then
    warn "no previous release pointer; cannot roll back automatically"
    return 1
  fi
  warn "rolling back to ${PREV_TAG} (${PREV_WEB_IMAGE:-unknown web image})"
  set +e
  TAG="$PREV_TAG" WEB_IMAGE="$PREV_WEB_IMAGE" WORKER_IMAGE="$PREV_WORKER_IMAGE" \
    "${COMPOSE[@]}" up -d --no-deps --force-recreate web-1 web-2 worker
  local up_status=$?
  local healthy=1
  wait_healthy web-1 || healthy=0
  wait_healthy web-2 || healthy=0
  wait_running worker || healthy=0
  if (( healthy == 1 )) && verify_public; then
    log "Rollback to ${PREV_TAG} is healthy"
  else
    warn "Rollback did not reach a healthy state; manual intervention required"
    healthy=0
  fi
  set -e
  if (( up_status != 0 )); then
    return "$up_status"
  fi
  return $(( healthy == 1 ? 0 : 1 ))
}

deploy_started=0
on_error() {
  local status="${1:-$?}"
  trap - ERR INT TERM HUP
  set +e
  if (( deploy_started == 1 )); then
    warn "release failed (exit ${status}) after containers were replaced"
    rollback_previous || warn "automatic rollback failed — follow deploy/RUNBOOK.md § rollback"
  else
    warn "release failed (exit ${status}) before any live container was replaced"
  fi
  exit "$status"
}
trap on_error ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM HUP

if [[ "${SKIP_PULL:-0}" == "1" ]]; then
  log "Using locally built images"
  docker image inspect "$WEB_IMAGE" >/dev/null 2>&1 || die "web image not found locally: ${WEB_IMAGE}"
  docker image inspect "$WORKER_IMAGE" >/dev/null 2>&1 || die "worker image not found locally: ${WORKER_IMAGE}"
else
  log "Pulling release images"
  for image in "$WEB_IMAGE" "$WORKER_IMAGE"; do
    pulled=0
    for attempt in 1 2 3; do
      if docker pull "$image"; then
        pulled=1
        break
      fi
      warn "pull failed (attempt ${attempt}/3): ${image}"
      sleep $(( attempt * 5 ))
    done
    (( pulled == 1 )) || die "could not pull ${image}"
  done
fi

log "Pulling infrastructure images"
"${COMPOSE[@]}" pull postgres redis redis-http caddy || warn "image pull failed; using cached images"

log "Starting data services"
"${COMPOSE[@]}" up -d postgres redis redis-http
wait_healthy postgres || die "postgres did not become healthy"
wait_healthy redis || die "redis did not become healthy"

if [[ "${BACKUP_BEFORE_MIGRATE:-1}" == "1" ]]; then
  if [[ "${SKIP_PRE_DEPLOY_BACKUP:-0}" == "1" ]]; then
    warn "pre-deploy backup skipped (SKIP_PRE_DEPLOY_BACKUP=1)"
  else
    log "Pre-deploy database backup"
    ./scripts/backup-postgres.sh || die "pre-deploy backup failed; release aborted before migrations"
  fi
fi

log "Running database migrations"
"${COMPOSE[@]}" run --rm --no-deps worker npm run db:migrate

deploy_started=1

log "Rolling web-1"
"${COMPOSE[@]}" up -d --no-deps --force-recreate web-1
wait_healthy web-1

log "Rolling web-2"
"${COMPOSE[@]}" up -d --no-deps --force-recreate web-2
wait_healthy web-2

log "Restarting queue worker"
"${COMPOSE[@]}" up -d --no-deps --force-recreate worker
wait_running worker

# Reload Caddy if it is already serving. On a brand-new host only start it when
# DNS points here, so we never burn Let's Encrypt rate limits on a bad record.
log "Edge (Caddy)"
DOMAIN="${TARTLY_DOMAIN:-$(printf '%s' "$PUBLIC_URL" | sed -E 's#https?://##; s#/.*##')}"
caddy_id=$("${COMPOSE[@]}" ps -q caddy 2>/dev/null || true)
if [[ -n "$caddy_id" ]]; then
  "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile || warn "caddy reload failed"
else
  PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}')
  if [[ -n "$PUBLIC_IP" && "$DNS_IP" == "$PUBLIC_IP" ]]; then
    "${COMPOSE[@]}" up -d --remove-orphans caddy
  else
    warn "DNS for ${DOMAIN} is ${DNS_IP:-unset}, expected ${PUBLIC_IP:-unknown}"
    warn "Skipping Caddy. Point an A record at this host, then run:"
    warn "  docker compose --env-file .env up -d caddy"
  fi
fi

log "Verifying public readiness"
verify_public

# Only now is this release considered live. Pointers and .env are updated last
# so a failed release leaves the previous rollback target intact.
if [[ -n "$PREV_TAG" ]]; then
  printf '%s\n' "$PREV_TAG" >.deploy/previous-tag
  printf '%s\n' "$PREV_WEB_IMAGE" >.deploy/previous-web-image
  printf '%s\n' "$PREV_WORKER_IMAGE" >.deploy/previous-worker-image
else
  rm -f .deploy/previous-tag .deploy/previous-web-image .deploy/previous-worker-image
fi
printf '%s\n' "$TAG" >.deploy/current-tag
printf '%s\n' "$WEB_IMAGE" >.deploy/current-web-image
printf '%s\n' "$WORKER_IMAGE" >.deploy/current-worker-image

# Keep bare `docker compose` commands on the same images as the release.
set_env_var TAG "$TAG"
set_env_var WEB_IMAGE "$WEB_IMAGE"
set_env_var WORKER_IMAGE "$WORKER_IMAGE"
chmod 600 .env 2>/dev/null || true

log "Cleaning old images"
docker image prune -f --filter "until=168h" >/dev/null || true
docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true

log "Deployed ${TAG}"
"${COMPOSE[@]}" ps
