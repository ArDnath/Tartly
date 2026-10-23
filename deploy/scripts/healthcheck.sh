#!/usr/bin/env bash
#
# Per-minute liveness probe for external monitoring (cron).
# Pings Healthchecks.io on success/failure and logs local pressure signals:
#   - readiness (Postgres + Redis through the app)
#   - disk: notice 60%, warn 75%, fail 85%
#   - memory: warn 80% used, fail 90% used
#   - TLS certificate: warn < 30 days, fail < 14 days
#
# A missing HEALTHCHECKS_URL does not disable the local checks; it only means
# there is no remote heartbeat. This is deliberately separate from the backup
# heartbeat (HEALTHCHECKS_BACKUP_URL) so a missed dump is never masked.
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

PUBLIC_URL=$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- | tr -d '"')
HC_URL=""
# shellcheck disable=SC1091
[[ -f /etc/tartly/backup.env ]] && . /etc/tartly/backup.env && HC_URL="${HEALTHCHECKS_URL:-}"

healthy=1
fail() {
  echo "$(date -u +%FT%TZ) $*" >&2
  healthy=0
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "${HC_URL}/fail" || true
}

# --- readiness -------------------------------------------------------------
body=$(curl -fsS --max-time 10 "${PUBLIC_URL}/api/health/ready" 2>/dev/null) || \
  fail "UNHEALTHY ${PUBLIC_URL}/api/health/ready"

# --- disk ------------------------------------------------------------------
usage=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if (( usage >= 85 )); then
  fail "CRITICAL disk ${usage}% on /"
elif (( usage >= 75 )); then
  echo "$(date -u +%FT%TZ) WARN disk ${usage}% on /" >&2
elif (( usage >= 60 )); then
  echo "$(date -u +%FT%TZ) NOTICE disk ${usage}% on /" >&2
fi

# --- memory ----------------------------------------------------------------
read -r mem_total mem_avail < <(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)
if [[ -n "${mem_total:-}" && -n "${mem_avail:-}" && "$mem_total" -gt 0 ]]; then
  mem_pct=$(( (mem_total - mem_avail) * 100 / mem_total ))
  if (( mem_pct >= 90 )); then
    fail "CRITICAL memory ${mem_pct}% used"
  elif (( mem_pct >= 80 )); then
    echo "$(date -u +%FT%TZ) WARN memory ${mem_pct}% used" >&2
  fi
fi

# --- TLS certificate -------------------------------------------------------
# Caddy renews automatically; this catches a silent renewal failure before a
# browser does. The check is cheap and runs off the loopback-facing hostname.
host=$(printf '%s' "$PUBLIC_URL" | sed -E 's#https?://##; s#/.*##')
if [[ -n "$host" ]] && command -v openssl >/dev/null 2>&1; then
  end=$(echo | openssl s_client -connect "${host}:443" -servername "$host" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2-) || true
  if [[ -n "${end:-}" ]]; then
    end_epoch=$(date -d "$end" +%s 2>/dev/null || true)
    if [[ -n "${end_epoch:-}" ]]; then
      days=$(( (end_epoch - $(date +%s)) / 86400 ))
      if (( days < 14 )); then
        fail "CRITICAL TLS certificate for ${host} expires in ${days}d"
      elif (( days < 30 )); then
        echo "$(date -u +%FT%TZ) WARN TLS certificate for ${host} expires in ${days}d" >&2
      fi
    fi
  else
    echo "$(date -u +%FT%TZ) WARN could not read TLS certificate for ${host}" >&2
  fi
fi

# --- heartbeat -------------------------------------------------------------
if (( healthy == 1 )); then
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "$HC_URL" || true
fi

exit $(( healthy == 1 ? 0 : 1 ))
