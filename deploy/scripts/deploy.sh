#!/usr/bin/env bash
#
# Build the production images on this host, then hand off to release.sh for the
# guarded deploy (backup -> migrations -> rolling restart -> readiness ->
# automatic rollback on failure).
#
#   cd /opt/tartly && git pull --ff-only
#   sudo -u deploy bash deploy/scripts/deploy.sh
#
# CI/CD uses prebuilt GHCR images instead and calls release.sh directly; see
# deploy/CI-CD.md.
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

WEB_IMAGE="tartly-web:${TAG}"
WORKER_IMAGE="tartly-worker:${TAG}"
export TAG WEB_IMAGE WORKER_IMAGE

log "Building web + worker (tag ${TAG})"
"${COMPOSE[@]}" build web-1 worker

log "Handing off to release.sh"
# The images now exist locally, so skip the registry pull inside release.sh.
SKIP_PULL=1 exec bash scripts/release.sh
