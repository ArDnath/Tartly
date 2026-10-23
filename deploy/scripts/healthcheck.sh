#!/usr/bin/env bash
#
# Liveness probe for external monitoring (runs every minute from cron).
# Pings Healthchecks.io on success/failure and shouts about disk pressure.
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

PUBLIC_URL=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- | tr -d '"')
HC_URL=""
# shellcheck disable=SC1091
[[ -f /etc/tartly/backup.env ]] && . /etc/tartly/backup.env && HC_URL="${HEALTHCHECKS_URL:-}"

healthy=1
body=$(curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready" 2>/dev/null) || healthy=0

if (( healthy == 1 )); then
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "$HC_URL" || true
else
  echo "$(date -u +%FT%TZ) UNHEALTHY ${PUBLIC_URL}/api/health/ready" >&2
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "${HC_URL}/fail" || true
fi

# Disk pressure: warn at 85%, escalate at 92%.
usage=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if (( usage >= 92 )); then
  echo "$(date -u +%FT%TZ) CRITICAL disk ${usage}% on /" >&2
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "${HC_URL}/fail" || true
elif (( usage >= 85 )); then
  echo "$(date -u +%FT%TZ) WARN disk ${usage}% on /" >&2
fi

(( healthy == 1 ))
