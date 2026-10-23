#!/usr/bin/env bash
#
# Disable SSH password authentication. Key-only from here on.
#
# Run only after `ssh deploy@<ip>` works with your key in a SECOND terminal.
# Root keeps key-based access (Hostinger web console / rescue remains usable);
# only passwords are removed.
#
#   sudo bash deploy/scripts/harden-ssh.sh
#
set -Eeuo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSHD_DIR=/etc/ssh/sshd_config.d
# Must sort BEFORE cloud-init's 50-cloud-init.conf: sshd uses the FIRST value
# it sees for each keyword, and cloud-init sets PasswordAuthentication yes.
CONF="${SSHD_DIR}/00-tartly.conf"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root"

log "Preflight"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "user ${DEPLOY_USER} does not exist"
[[ -s "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]] || die "no authorized_keys for ${DEPLOY_USER}"
[[ -s /root/.ssh/authorized_keys ]] || die "no authorized_keys for root (would lock out the console)"

keys=$(grep -cE '^(ssh-(ed25519|rsa)|ecdsa-)' "/home/${DEPLOY_USER}/.ssh/authorized_keys" || true)
(( keys > 0 )) || die "no valid public keys found for ${DEPLOY_USER}"
echo "found ${keys} key(s) for ${DEPLOY_USER}"

log "Writing ${CONF}"
install -d -m 0755 "$SSHD_DIR"
cat >"$CONF" <<'EOF'
# Managed by Tartly. Key-only authentication.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no

# Root may log in with a key (Hostinger console/rescue path); never a password.
PermitRootLogin prohibit-password

MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 3
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding yes
EOF

log "Neutralising cloud-init's password-auth default"
for f in "$SSHD_DIR"/*cloud-init*.conf; do
  [[ -f "$f" ]] || continue
  sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' "$f"
done
rm -f "${SSHD_DIR}/99-tartly.conf"

log "Validating configuration"
sshd -t || die "sshd -t failed; configuration NOT applied"

log "Reloading sshd"
systemctl reload ssh 2>/dev/null || systemctl reload sshd

cat <<EOF

SSH is now key-only.
  - Verify in a NEW terminal before closing this one:
        ssh ${DEPLOY_USER}@<ip>
  - Password logins (including root) are disabled.
  - fail2ban is watching sshd.
EOF
