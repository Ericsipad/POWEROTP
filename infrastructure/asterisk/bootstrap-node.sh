#!/bin/bash
# Provision a brand-new PowerOTP telephony node from a stock Ubuntu 24.04
# DigitalOcean droplet, to the exact shape powerotpvoip1 is in today. Run as
# root on the new droplet. Idempotent: safe to re-run.
#
# This is the disaster-recovery path — if the node is lost or has to move to a
# new IP, this plus a push to `main` rebuilds it. It replaces the hand-run
# steps that used to live only in README.md; that file now describes what this
# does and why rather than restating the commands.
#
# Required environment:
#   NODE_SECRET           same value as App Platform's NODE_SECRET
#   OPS_PUBKEY            ssh public key for human access (opsadmin)
#   CI_DEPLOY_PUBKEY      ssh public key for GitHub Actions (potp-deploy)
# Optional:
#   MEDIA_MANIFEST_SECRET same value as App Platform's; enables voice_challenge
#                         media sync. Omit on a node that never serves it.
#   CONTROL_PLANE_URL     defaults to https://powerotp.com
#
# Secrets are read from the environment and written only to root-owned files
# under /etc/powerotp; nothing is echoed. The ARI password is generated here and
# never leaves the box (the control plane neither needs nor stores it).
#
# What this does NOT do: deploy application code. After it finishes, push to
# `main` (or re-run the deploy-droplet job) and the CI forced-command deploy
# populates /opt/powerotp. See README.md.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
for v in NODE_SECRET OPS_PUBKEY CI_DEPLOY_PUBKEY; do
  [[ -n "${!v:-}" ]] || { echo "missing required env var: $v" >&2; exit 1; }
done
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://powerotp.com}"
step() { printf '\n=== %s\n' "$1"; }

step "swap (npm ci OOM-kills on this droplet size without it)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show

step "packages: asterisk 20, fail2ban, ufw, node 22 (NodeSource)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq asterisk fail2ban ufw curl ca-certificates gnupg
if ! command -v node >/dev/null || ! node --version | grep -q '^v22'; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  cat > /etc/apt/sources.list.d/nodesource.sources <<'EOF'
Types: deb
URIs: https://deb.nodesource.com/node_22.x
Suites: nodistro
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/nodesource.gpg
EOF
  apt-get update -qq && apt-get install -y -qq nodejs
fi
node --version

step "accounts: opsadmin (human), potp-agent (runtime), potp-deploy (CI)"
id opsadmin >/dev/null 2>&1 || adduser --disabled-password --gecos '' opsadmin
usermod -aG sudo opsadmin
printf 'opsadmin ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/opsadmin
chmod 0440 /etc/sudoers.d/opsadmin
# potp-agent: no login, member of `asterisk` so it can reach the control socket
# and rewrite pjsip_trunks.conf.
id potp-agent >/dev/null 2>&1 \
  || useradd --system --no-create-home --shell /usr/sbin/nologin --gid asterisk potp-agent
# potp-deploy: primary group `asterisk` + the deploy script's umask 027 is what
# makes CI-built files readable by potp-agent with no root chown.
id potp-deploy >/dev/null 2>&1 \
  || useradd --system --create-home --home-dir /var/lib/potp-deploy \
             --shell /bin/bash --gid asterisk potp-deploy

step "ssh keys (human unrestricted; CI pinned to one forced command)"
install -d -o opsadmin -g opsadmin -m 0700 /home/opsadmin/.ssh
printf '%s\n' "$OPS_PUBKEY" > /home/opsadmin/.ssh/authorized_keys
chown opsadmin:opsadmin /home/opsadmin/.ssh/authorized_keys
chmod 0600 /home/opsadmin/.ssh/authorized_keys

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -o root -g root -m 0755 "$HERE/potp-deploy" /usr/local/bin/potp-deploy
install -o root -g root -m 0440 "$HERE/sudoers-potp-deploy" /etc/sudoers.d/potp-deploy
visudo -c -f /etc/sudoers.d/potp-deploy
install -d -o potp-deploy -g asterisk -m 0700 /var/lib/potp-deploy/.ssh
printf 'command="/usr/local/bin/potp-deploy",restrict %s\n' "$CI_DEPLOY_PUBKEY" \
  > /var/lib/potp-deploy/.ssh/authorized_keys
chown potp-deploy:asterisk /var/lib/potp-deploy/.ssh/authorized_keys
chmod 0600 /var/lib/potp-deploy/.ssh/authorized_keys
install -d -o potp-deploy -g asterisk -m 0750 /opt/powerotp

step "sshd hardening (verifying opsadmin key landed first, to avoid lockout)"
test -s /home/opsadmin/.ssh/authorized_keys
install -o root -g root -m 0644 "$HERE/sshd-hardening.conf" \
  /etc/ssh/sshd_config.d/10-powerotp-hardening.conf
sshd -t
systemctl reload ssh
sshd -T | grep -E '^(permitrootlogin|allowusers)'

step "firewall: default-deny inbound except 22, plus the egress abuse guard"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
# Nothing here legitimately makes outbound SSH/SMTP/RDP connections: the agent
# speaks HTTPS to the control plane and SIP over UDP, and email goes through
# Brevo's API from apps/web. Denying these means a future compromise cannot
# turn this node into the brute-force bot a phishing mail once claimed it was.
for p in 22 23 25 445 465 587 3389; do
  ufw deny out "$p"/tcp comment 'egress-abuse-guard' >/dev/null
done
ufw logging low >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban
ufw status verbose

step "asterisk: localhost-only ARI, one transport, placeholder dialplan"
ARI_PASS="$(openssl rand -hex 24)"
if ! grep -qE '^\s*enabled\s*=\s*yes' /etc/asterisk/http.conf; then
  cat >> /etc/asterisk/http.conf <<'EOF'

; PowerOTP: ARI's HTTP server, bound to loopback only and never exposed.
[general]
enabled=yes
bindaddr=127.0.0.1
EOF
fi
if ! grep -q 'powerotp-agent' /etc/asterisk/ari.conf; then
  cat >> /etc/asterisk/ari.conf <<EOF

; PowerOTP: the single local ARI user apps/telephony-agent authenticates as.
; This password is generated per node and exists only here and in
; /etc/powerotp/ari.env - the control plane never sees it.
[general]
enabled = yes
[powerotp-agent]
type=user
password = ${ARI_PASS}
read_only=no
EOF
fi
grep -q '^#include pjsip_trunks.conf' /etc/asterisk/pjsip.conf \
  || echo '#include pjsip_trunks.conf' >> /etc/asterisk/pjsip.conf
grep -q '^\[transport-udp\]' /etc/asterisk/pjsip.conf \
  || cat "$HERE/pjsip-transport.conf" >> /etc/asterisk/pjsip.conf
if ! grep -q '^\[powerotp-outbound\]' /etc/asterisk/extensions.conf; then
  cat >> /etc/asterisk/extensions.conf <<'EOF'

; PowerOTP: endpoints point their context here. Real call control happens over
; ARI (originating into a Stasis app bypasses the dialplan entirely), so this
; only needs to exist, not do anything.
[powerotp-outbound]
exten => _X.,1,NoOp(POWEROTP outbound trunk registered, no dialplan wired yet)
 same => n,Hangup()
EOF
fi
# IAX2 is unused (all trunks are PJSIP) but loads by default, listening on
# udp/4569 with Asterisk's packaged anonymous [guest] user. Remove the surface.
grep -qE '^\s*noload\s*=>\s*chan_iax2\.so' /etc/asterisk/modules.conf \
  || sed -i 's|^\[modules\]|[modules]\nnoload => chan_iax2.so|' /etc/asterisk/modules.conf
# The packaged unit doesn't apply asterisk.conf's astctlpermissions reliably, so
# the control socket comes back owner-write-only on every restart and the agent
# can't issue `pjsip reload`. Fixed with the drop-in, not a one-off chmod.
install -d -m 0755 /etc/systemd/system/asterisk.service.d
install -o root -g root -m 0644 "$HERE/asterisk.service.d-override.conf" \
  /etc/systemd/system/asterisk.service.d/override.conf

step "agent config + service"
install -d -o root -g root -m 0755 /etc/powerotp
{
  echo "CONTROL_PLANE_URL=${CONTROL_PLANE_URL}"
  echo "ASTERISK_PJSIP_TRUNKS_PATH=/etc/asterisk/pjsip_trunks.conf"
  echo "POLL_INTERVAL_MS=60000"
  echo "NODE_SECRET=${NODE_SECRET}"
  if [[ -n "${MEDIA_MANIFEST_SECRET:-}" ]]; then
    echo "MEDIA_MANIFEST_SECRET=${MEDIA_MANIFEST_SECRET}"
    echo "MEDIA_ROOT=/var/lib/asterisk/sounds/custom"
  fi
} > /etc/powerotp/agent.env
{
  echo "ARI_URL=http://127.0.0.1:8088"
  echo "ARI_USER=powerotp-agent"
  echo "ARI_PASS=${ARI_PASS}"
} > /etc/powerotp/ari.env
chown root:asterisk /etc/powerotp/agent.env /etc/powerotp/ari.env
chmod 0640 /etc/powerotp/agent.env /etc/powerotp/ari.env
install -d -o potp-agent -g asterisk -m 0755 /var/lib/asterisk/sounds/custom
install -o root -g root -m 0644 "$HERE/powerotp-agent.service" \
  /etc/systemd/system/powerotp-agent.service
systemctl daemon-reload
systemctl enable powerotp-agent
systemctl restart asterisk
sleep 3
systemctl is-active asterisk

cat <<EOF

=== provisioned. remaining manual steps (all IP-dependent) ===
1. Deploy code: push to main, or re-run the deploy-droplet job. The agent will
   not start cleanly until /opt/powerotp is populated.
2. Update these GitHub repo secrets for the new address:
     DROPLET_HOST          the new IP
     DROPLET_SSH_HOST_KEY  new known_hosts line, from:
                             ssh-keyscan -t ed25519 <new-ip>
                           (verify it against this box's
                            /etc/ssh/ssh_host_ed25519_key.pub before trusting)
3. Repoint DNS na1.powerotp.com at the new IP.
4. Update the local ~/.ssh/config \`powerotp\` alias (HostName, User opsadmin).
5. Check VoIP.ms: if the subaccounts restrict by source IP, add the new one.
6. Update the IP recorded in docs/AS_BUILT.md.
EOF
