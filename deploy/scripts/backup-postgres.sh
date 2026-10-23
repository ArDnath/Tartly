#!/usr/bin/env bash
#
# Nightly logical backup: pg_dump -Fc | zstd, local retention + R2 offsite.
# Runs from /etc/cron.d/tartly at 02:15 UTC.
#
# Restore drill (do this monthly — an untested backup is not a backup):
#   ./scripts/restore-postgres.sh /var/backups/tartly/tartly-YYYY....dump.zst
#
set -Eeuo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/tartly}"
# A dump is a full second copy of the DB on the same disk. At 10 GB a 14-day
# retention can eat 30-40 GB; R2 is the backup of record (guide §13.5.1).
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-3}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-30}"

HC_URL="" RCLONE_REMOTE="" RCLONE_BUCKET=""
# shellcheck disable=SC1091
if [[ -f /etc/tartly/backup.env ]]; then . /etc/tartly/backup.env; fi
# The readiness probe pings HEALTHCHECKS_URL every minute. The backup heartbeat
# MUST be its own check (6 h period + grace): falling back to the readiness URL
# would make a missed backup invisible, because every minute would look like a
# ping. No separate URL means no heartbeat, with a loud warning.
HC_URL="${HEALTHCHECKS_BACKUP_URL:-}"
if [[ -z "$HC_URL" ]]; then
  echo "  backup heartbeat disabled (HEALTHCHECKS_BACKUP_URL unset)" >&2
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-r2}"
RCLONE_BUCKET="${RCLONE_BUCKET:-tartly-backups}"

mkdir -p "$BACKUP_DIR"

# Refuse to fill the disk. A failed backup is recoverable; a full disk is an
# outage for Postgres and for every later backup.
AVAIL_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2{print $4}')
if (( AVAIL_KB < 5 * 1024 * 1024 )); then
  echo "$(date -u +%FT%TZ) REFUSING: less than 5 GB free on ${BACKUP_DIR}" >&2
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "${HC_URL}/fail" || true
  exit 1
fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="${BACKUP_DIR}/tartly-${STAMP}.dump.zst"
TMP="${TARGET}.partial"

echo "$(date -u +%FT%TZ) backup start -> ${TARGET}"

# Write to a temp path so a failed dump never masquerades as a good backup.
if ! docker compose --env-file .env exec -T postgres \
      pg_dump -U tartly -d tartly --format=custom --compress=0 \
      | zstd -T0 -10 -q -o "$TMP"; then
  rm -f "$TMP"
  echo "$(date -u +%FT%TZ) BACKUP FAILED" >&2
  [[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "${HC_URL}/fail" || true
  exit 1
fi

zstd -t -q "$TMP"
mv "$TMP" "$TARGET"
chmod 600 "$TARGET"
SIZE=$(du -h "$TARGET" | cut -f1)
echo "  dump ok (${SIZE})"

find "$BACKUP_DIR" -name 'tartly-*.dump.zst' -type f -mtime +"$LOCAL_KEEP_DAYS" -delete

# `rclone listremotes` only reads rclone.conf; the R2 backend here is configured
# entirely through RCLONE_CONFIG_R2_* env vars, so accept an explicit endpoint
# as proof the remote exists. Requiring both key and secret avoids a half-filled
# config silently falling through to "offsite disabled".
if command -v rclone >/dev/null 2>&1 \
   && [[ -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" ]] \
   && [[ -n "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:-}" ]] \
   && { rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:" \
        || [[ -n "${RCLONE_CONFIG_R2_ENDPOINT:-}" ]]; }; then
  echo "  uploading to ${RCLONE_REMOTE}:${RCLONE_BUCKET}/postgres/"
  rclone copy "$TARGET" "${RCLONE_REMOTE}:${RCLONE_BUCKET}/postgres/" --s3-no-check-bucket
  rclone delete "${RCLONE_REMOTE}:${RCLONE_BUCKET}/postgres/" --min-age "${REMOTE_KEEP_DAYS}d"
else
  echo "  offsite disabled (rclone/R2 not configured in /etc/tartly/backup.env)"
fi

[[ -n "$HC_URL" ]] && curl -fsS --max-time 5 -o /dev/null "$HC_URL" || true
echo "$(date -u +%FT%TZ) backup done"
