#!/usr/bin/env bash
#
# Read-only capacity snapshot for the 10k-user target (guide §2.7, §16.2b).
# Run on the VPS from the deploy directory:
#
#   cd /opt/tartly/deploy && ./scripts/capacity-report.sh
#
# It changes nothing: no writes, no pruning, no restarts. Safe to run under load.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose --env-file .env)
PGUSER="${POSTGRES_USER:-tartly}"
PGDB="${POSTGRES_DB:-tartly}"

WARN=0
warn() { printf '  \033[1;33m!! %s\033[0m\n' "$*"; WARN=1; }
section() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

section "Host"
date -u '+UTC %Y-%m-%d %H:%M:%S'
printf 'CPU:   %s vCPU, load %s\n' "$(nproc)" "$(cut -d' ' -f1-3 /proc/loadavg)"
free -h | sed -n '1,3p'
df -h / | sed -n '1,2p'

DISK_PCT=$(df -Pk / | awk 'NR==2{print $5}' | tr -d '%')
DISK_AVAIL_KB=$(df -Pk / | awk 'NR==2{print $4}')

section "Containers"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null || warn "docker stats unavailable"

section "Docker disk"
docker system df 2>/dev/null || true
IMG_COUNT=$(docker images -q 2>/dev/null | wc -l | tr -d ' ')
printf 'Images: %s\n' "$IMG_COUNT"

section "Postgres"
DB_BYTES=$("${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "$PGDB" -tAc \
  "select pg_database_size(current_database())" 2>/dev/null | tr -d '[:space:]' || true)
DB_BYTES=${DB_BYTES:-0}

"${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 <<'SQL' 2>/dev/null || warn "Postgres not reachable"
\pset pager off
select 'db_size' as metric, pg_size_pretty(pg_database_size(current_database())) as value
union all select 'messages', count(*)::text from messages
union all select 'messages_table', pg_size_pretty(pg_total_relation_size('messages'))
union all select 'bytes_per_message',
  case when count(*) = 0 then '0'
       else (pg_total_relation_size('messages') / count(*))::bigint::text end
  from messages
union all select 'connections', count(*)::text from pg_stat_activity
union all select 'max_connections', current_setting('max_connections')
union all select 'cache_hit_pct',
  coalesce(round(sum(blks_hit) * 100.0 / nullif(sum(blks_hit + blks_read), 0), 2)::text, 'n/a')
  from pg_stat_database where datname = current_database();

\echo '-- top tables --'
select relname as table, pg_size_pretty(pg_total_relation_size(oid)) as size
from pg_class
where relkind = 'r' and relnamespace = 'public'::regnamespace
order by pg_total_relation_size(oid) desc
limit 8;
SQL

if "${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "$PGDB" -tAc \
     "select 1 from pg_extension where extname = 'pg_stat_statements'" 2>/dev/null | grep -q 1; then
  printf '\n-- pg_stat_statements: top 5 by total time --\n'
  "${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "$PGDB" -c \
    "select round(total_exec_time::numeric, 1) as total_ms, calls,
            round(mean_exec_time::numeric, 1) as mean_ms, left(query, 90) as query
     from pg_stat_statements order by total_exec_time desc limit 5" 2>/dev/null || true
else
  echo "  (pg_stat_statements not installed — see guide §6.1)"
fi

section "Redis"
"${COMPOSE[@]}" exec -T redis redis-cli info memory 2>/dev/null \
  | grep -E '^(used_memory_human|maxmemory_human|maxmemory_policy):' || warn "Redis not reachable"
"${COMPOSE[@]}" exec -T redis redis-cli info keyspace 2>/dev/null | sed -n '2,3p' || true

section "Backups"
if [[ -d /var/backups/tartly ]]; then
  du -sh /var/backups/tartly 2>/dev/null || true
  COUNT=$(find /var/backups/tartly -maxdepth 1 -name 'tartly-*.dump.zst' -type f 2>/dev/null | wc -l | tr -d ' ')
  printf 'Local dumps: %s\n' "$COUNT"
  find /var/backups/tartly -maxdepth 1 -name 'tartly-*.dump.zst' -type f 2>/dev/null \
    | sort | tail -1 | sed 's/^/Newest: /'
  (( COUNT > 3 )) && warn "more than 3 local dumps — R2 is the backup of record" || true
else
  warn "/var/backups/tartly missing"
fi

section "Assessment (10k-user envelope)"
GB=$((1024 * 1024 * 1024))
DB_GB=$((DB_BYTES / GB))
printf 'Disk used: %s%%  (warn 60, critical 85)\n' "$DISK_PCT"
printf 'DB size:   %s GiB  (managed-DB trigger 20 GiB)\n' "$DB_GB"
if (( DISK_PCT >= 85 )); then warn "disk is critical"; fi
if (( DISK_PCT >= 60 )); then warn "disk above 60% — review body lifecycle (A8)"; fi
if (( DISK_AVAIL_KB < 10 * 1024 * 1024 )); then warn "less than 10 GB free"; fi
if (( DB_GB >= 20 )); then warn "DB >= 20 GiB — see guide §6.9 managed-Postgres trigger"; fi

if (( WARN == 0 )); then
  printf '\n\033[1;32mAll checks within the single-node envelope.\033[0m\n'
else
  printf '\n\033[1;33mWarnings above need a decision; nothing was changed.\033[0m\n'
fi
