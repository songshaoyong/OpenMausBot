#!/usr/bin/env bash
# Installs Incus for OpenMausBot's Incus computers, trusts a client certificate, and prints the
# values Settings → Computers → Incus asks for. Safe to run again; it keeps an existing certificate.
set -euo pipefail

OUT="${OMB_INCUS_CERT_DIR:-$HOME/.openmausbot-incus}"
SUITE="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
ARCH="$(dpkg --print-architecture)"

if ! command -v incus >/dev/null 2>&1; then
  echo "Installing Incus from the upstream stable repository (Ubuntu's own build has no OCI images)."
  sudo install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://pkgs.zabbly.com/key.asc | sudo tee /etc/apt/keyrings/zabbly.asc >/dev/null
  sudo tee /etc/apt/sources.list.d/zabbly-incus-stable.sources >/dev/null <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${SUITE}
Components: main
Architectures: ${ARCH}
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF
  sudo apt-get update
  sudo apt-get install -y incus
fi

incus version

# An OCI image source needs 6.11 or newer; say so before the first bot fails on it.
INCUS_MAJOR="$(incus version | awk '/^Client version:/ {print $3}' | cut -d. -f1)"
INCUS_MINOR="$(incus version | awk '/^Client version:/ {print $3}' | cut -d. -f2)"
if [ "${INCUS_MAJOR}" -lt 6 ] || { [ "${INCUS_MAJOR}" -eq 6 ] && [ "${INCUS_MINOR}" -lt 11 ]; }; then
  echo "This Incus is older than 6.11, which added OCI image sources. Upgrade before using Incus computers." >&2
fi

if ! sudo incus storage list --format csv 2>/dev/null | grep -q .; then
  echo "Initializing Incus (a storage pool and the incusbr0 network)."
  sudo incus admin init --minimal
fi

sudo incus config set core.https_address=:8443

mkdir -p "${OUT}"
chmod 0700 "${OUT}"
if [ ! -f "${OUT}/client.crt" ] || [ ! -f "${OUT}/client.key" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -keyout "${OUT}/client.key" -out "${OUT}/client.crt" \
    -subj "/CN=openmausbot" -addext "extendedKeyUsage=clientAuth"
fi

if ! sudo incus config trust list --format csv | grep -q openmausbot; then
  sudo incus config trust add-certificate "${OUT}/client.crt" --name openmausbot
fi

# Docker sets the forwarded-traffic policy to DROP; the Incus bridge needs its own accept ahead of it,
# or a bot's desktop has no network at all.
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -C DOCKER-USER -i incusbr0 -j ACCEPT 2>/dev/null || sudo iptables -I DOCKER-USER -i incusbr0 -j ACCEPT
  sudo iptables -C DOCKER-USER -o incusbr0 -j ACCEPT 2>/dev/null || sudo iptables -I DOCKER-USER -o incusbr0 -j ACCEPT
fi

sudo cat /var/lib/incus/server.crt > "${OUT}/server.crt"

HOST_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
cat <<EOF

Done. Paste these into Settings → Computers → Incus:

  API address:  https://host.docker.internal:8443    (OpenMausBot in Docker)
                https://${HOST_IP}:8443    (OpenMausBot on this host)
  Project:      default
  Client cert:  ${OUT}/client.crt
  Client key:   ${OUT}/client.key
  Server cert:  ${OUT}/server.crt

The client certificate is the whole credential: anyone who can read ${OUT} can
control every container on this Incus server.
EOF
