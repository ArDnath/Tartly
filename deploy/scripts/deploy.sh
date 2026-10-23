#!/usr/bin/env bash
#
# Build, migrate and roll the production stack. Run on the VPS from the repo:
#
#   cd /opt/tartly && git pull --ff-only
#   sudo -u deploy bash deploy/scripts/deploy.sh
#
# Ordering is deliberate: image build -> infra healthy -> migrations -> web
# replicas -> worker -> edge. A failed migration aborts before traffic moves.
#
set -Eeuo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env -f docker-compose.yml)

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

log "Preflight"
[[ -f .env ]] || die "deploy/.env missing — run: node deploy/scripts/render-env.mjs (on your workstation) then copy it here"
[[ -f app.env ]] || die "deploy/app.env missing — render it on your workstation and scp it here"
[[ $(stat -c '%a' app.env) == "600" ]] || warn "app.env permissions are $(stat -c '%a' app.env) (expected 600)"
command -v docker >/dev/null || die "docker not installed — run bootstrap.sh first"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is the user in the docker group?)"

set -a
# shellcheck disable=SC1091
. ./.env
set +a
[[ -n "${PUBLIC_URL:-}" ]] || die "PUBLIC_URL missing from deploy/.env"

# Traceable image tag. A dirty tree is marked so a deploy of uncommitted work
# is never mistaken for a clean release (and rollback stays unambiguous).
GIT_SHA=$(git -C .. rev-parse --short HEAD 2>/dev/null || true)
if [[ -n "$GIT_SHA" ]]; then
  if [[ -n "$(git -C .. status --porcelain 2>/dev/null)" ]]; then
    TAG="${GIT_SHA}-dirty-$(date -u +%Y%m%d%H%M%S)"
    warn "working tree is dirty — image tagged ${TAG}"
  else
    TAG="$GIT_SHA"
  fi
else
  TAG="$(date -u +%Y%m%d%H%M%S)"
fi
export TAG

mkdir -p .deploy
if [[ -f .deploy/current-tag ]]; then
  cp .deploy/current-tag .deploy/previous-tag
fi
echo "$TAG" >.deploy/current-tag

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

log "Pulling infrastructure images"
"${COMPOSE[@]}" pull postgres redis redis-http caddy || warn "image pull failed; using cached images"

log "Building web + worker (tag ${TAG})"
"${COMPOSE[@]}" build web-1 worker

log "Starting data services"
"${COMPOSE[@]}" up -d postgres redis redis-http
wait_healthy postgres
wait_healthy redis

log "Running database migrations"
"${COMPOSE[@]}" run --rm --no-deps worker npm run db:migrate

log "Rolling web replicas"
"${COMPOSE[@]}" up -d --no-deps web-1
wait_healthy web-1
"${COMPOSE[@]}" up -d --no-deps web-2
wait_healthy web-2

log "Starting queue worker"
"${COMPOSE[@]}" up -d --no-deps worker

# Only start Caddy once DNS points here: issuing certificates for a name that
# resolves elsewhere burns Let's Encrypt rate limits.
log "Edge (Caddy)"
DOMAIN="${TARTLY_DOMAIN:-$(printf '%s' "$PUBLIC_URL" | sed -E 's#https?://##; s#/.*##')}"
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}')
if [[ -n "$PUBLIC_IP" && "$DNS_IP" == "$PUBLIC_IP" ]]; then
  caddy_id=$("${COMPOSE[@]}" ps -q caddy 2>/dev/null || true)
  if [[ -n "$caddy_id" ]]; then
    "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile
  else
    "${COMPOSE[@]}" up -d --remove-orphans caddy
  fi
  log "Verifying public endpoint"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready" >/dev/null; then
      echo "  ${PUBLIC_URL} is ready"
      break
    fi
    sleep 4
  done
else
  warn "DNS for ${DOMAIN} is ${DNS_IP:-unset}, expected ${PUBLIC_IP:-unknown}"
  warn "Skipping Caddy. Point an A record at ${PUBLIC_IP:-this host}, then run:"
  warn "  docker compose --env-file .env up -d caddy"
fi

log "Cleaning up old images"
docker image prune -f --filter "until=168h" >/dev/null || true
# Build cache is the other disk grower on a 100 GB node (~6 GB after one build).
docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true

log "Deployed ${TAG}"
"${COMPOSE[@]}" ps
