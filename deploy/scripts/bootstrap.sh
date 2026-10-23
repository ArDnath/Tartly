#!/usr/bin/env bash
#
# Tartly — one-time host bootstrap for a fresh Ubuntu 24.04/26.04 VPS.
# Idempotent: safe to re-run. Does NOT disable SSH password login; run
# harden-ssh.sh only after you have verified key access as `deploy`.
#
#   sudo bash deploy/scripts/bootstrap.sh
#
set -Eeuo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/tartly}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tartly}"
SSH_PORT="${SSH_PORT:-22}"
SWAP_GB="${SWAP_GB:-4}"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash $0)"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

log "Base packages"
apt-get update -qq
apt-get -y -qq upgrade
apt-get -y -qq install \
  ca-certificates curl gnupg git rsync ufw fail2ban unattended-upgrades \
  apt-listchanges dnsutils zstd jq htop chrony rclone logrotate \
  build-essential python3

log "Swap (${SWAP_GB}G) — protects the image build on a 2 vCPU node"
if ! swapon --show | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024)) status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "swap already active"
fi

log "Kernel tuning"
cat >/etc/sysctl.d/99-tartly.conf <<'EOF'
vm.swappiness = 10
vm.overcommit_memory = 1
fs.file-max = 200000
net.core.somaxconn = 4096
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_congestion_control = bbr
net.ipv4.ip_local_port_range = 10240 65000
EOF
sysctl --system >/dev/null

log "Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  . /etc/os-release
  CODENAME="${VERSION_CODENAME:-}"
  install -m 0755 -d /etc/apt/keyrings
  if [[ -n "$CODENAME" ]] && curl -fsSL --max-time 10 \
      "https://download.docker.com/linux/ubuntu/dists/${CODENAME}/Release" >/dev/null 2>&1; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get -y -qq install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    warn "Docker's apt repo has no '${CODENAME}' suite yet; using Ubuntu packages"
    apt-get -y -qq install docker.io docker-compose-v2
  fi
fi
systemctl enable --now docker

log "Docker daemon limits (log rotation, live-restore)"
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "default-address-pools": [
    { "base": "172.30.0.0/16", "size": 24 }
  ]
}
EOF
systemctl restart docker
docker compose version >/dev/null || die "docker compose plugin missing"

log "Deploy user: ${DEPLOY_USER}"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo,docker "$DEPLOY_USER"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"

# Trust the root account's keys for the deploy user (so the same key works).
if [[ -s /root/.ssh/authorized_keys ]]; then
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
    /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  sort -u "/home/${DEPLOY_USER}/.ssh/authorized_keys" -o "/home/${DEPLOY_USER}/.ssh/authorized_keys"
else
  warn "No /root/.ssh/authorized_keys yet — add your public key before hardening SSH"
fi

cat >/etc/sudoers.d/90-tartly-deploy <<EOF
${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL
EOF
chmod 0440 /etc/sudoers.d/90-tartly-deploy

log "Directories"
install -d -m 0755 "$APP_DIR"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BACKUP_DIR"
install -d -m 0755 /etc/tartly
touch /var/log/tartly-cron.log
chown "$DEPLOY_USER":"$DEPLOY_USER" /var/log/tartly-cron.log

log "Firewall (UFW)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (ACME + redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow 443/udp comment 'HTTP/3' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

log "fail2ban (sshd)"
cat >/etc/fail2ban/jail.d/tartly.local <<'EOF'
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
ignoreip = 127.0.0.1/8 ::1
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Unattended security upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

log "Time sync"
systemctl enable --now chrony

log "Cron: backups, scheduled tasks, health probe"
cat >/etc/cron.d/tartly <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Nightly logical backup (local + R2 offsite)
15 2 * * * ${DEPLOY_USER} cd ${APP_DIR}/deploy && ./scripts/backup-postgres.sh >>/var/log/tartly-cron.log 2>&1
# Daily safety-net (watch renew, digests, retention, reconcile)
0 3 * * * ${DEPLOY_USER} cd ${APP_DIR}/deploy && ./scripts/cron.sh daily >>/var/log/tartly-cron.log 2>&1
# Follow-up enrollment sweep
*/5 * * * * ${DEPLOY_USER} cd ${APP_DIR}/deploy && ./scripts/cron.sh followups >>/var/log/tartly-cron.log 2>&1
# Autopilot review sweep
*/15 * * * * ${DEPLOY_USER} cd ${APP_DIR}/deploy && ./scripts/cron.sh autopilot >>/var/log/tartly-cron.log 2>&1
# Readiness probe + disk pressure -> Healthchecks.io
* * * * * ${DEPLOY_USER} cd ${APP_DIR}/deploy && ./scripts/healthcheck.sh >>/var/log/tartly-cron.log 2>&1
EOF
chmod 0644 /etc/cron.d/tartly

cat >/etc/logrotate.d/tartly <<'EOF'
/var/log/tartly-cron.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF

log "Offsite backup config (fill in R2 credentials)"
if [[ ! -f /etc/tartly/backup.env ]]; then
  cat >/etc/tartly/backup.env <<'EOF'
# Sourced by deploy/scripts/backup-postgres.sh
RCLONE_REMOTE=r2
RCLONE_BUCKET=tartly-backups
HEALTHCHECKS_URL=
# rclone S3 backend for Cloudflare R2:
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=
# e.g. https://<account-id>.r2.cloudflarestorage.com  (no angle brackets once filled)
RCLONE_CONFIG_R2_ENDPOINT=
EOF
  chmod 600 /etc/tartly/backup.env
  chown "$DEPLOY_USER":"$DEPLOY_USER" /etc/tartly/backup.env
fi

log "Done"
cat <<EOF

Host is ready. Next:
  1. From your workstation, verify:  ssh ${DEPLOY_USER}@<this-ip>
  2. Install the app:                 sudo -u ${DEPLOY_USER} bash ${APP_DIR}/deploy/scripts/deploy.sh
  3. Then lock down SSH:              sudo bash ${APP_DIR}/deploy/scripts/harden-ssh.sh

Firewall: 22, 80, 443 open. Everything else closed.
Backups:  ${BACKUP_DIR} (local) + ${DEPLOY_USER}'s crontab.
EOF
