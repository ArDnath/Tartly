#!/usr/bin/env bash
#
# Invoke a scheduled application task with the CRON_SECRET bearer token.
#
#   ./scripts/cron.sh daily
#   ./scripts/cron.sh followups
#   ./scripts/cron.sh autopilot
#
# Installed in /etc/cron.d/tartly by bootstrap.sh.
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

JOB="${1:?usage: cron.sh <daily|followups|autopilot|drain>}"
case "$JOB" in
  daily|followups|autopilot|drain) ;;
  *) echo "unknown job: $JOB" >&2; exit 2 ;;
esac

PUBLIC_URL=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- | tr -d '"')
SECRET=$(grep -E '^CRON_SECRET=' app.env | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || true)
[[ -n "$SECRET" ]] || { echo "CRON_SECRET missing from app.env" >&2; exit 1; }

printf '%s cron/%s ' "$(date -u +%FT%TZ)" "$JOB"
curl -fsS --max-time 180 \
  -H "Authorization: Bearer ${SECRET}" \
  "${PUBLIC_URL}/api/v1/cron/${JOB}"
printf '\n'
