#!/usr/bin/env bash
# Builds the Incus desktop image OpenMausBot's Incus computers launch, when a registry pull is not
# possible (a blocked registry, an air-gapped host): Xvfb + fluxbox + the pinned Cua Driver, answering
# on the same socket and uid the Docker managed image uses. Run it as root on the Incus server.
set -euo pipefail

NAME="${OMB_INCUS_BUILD_INSTANCE:-omb-desktop-build}"
ALIAS="${OMB_INCUS_DESKTOP_ALIAS:-openmausbot-desktop}"
BASE="${OMB_INCUS_BUILD_BASE:-images:ubuntu/24.04}"
DRIVER_VERSION="0.37.0"
WHEEL_X86_64="https://files.pythonhosted.org/packages/3b/b0/97f6d8828b8a6ca3649ad7150ddbc23addde56f014c9bd407876484ecb8d/cua_driver-${DRIVER_VERSION}-py3-none-manylinux_2_31_x86_64.whl"
WHEEL_AARCH64="https://files.pythonhosted.org/packages/dc/33/81e2531353837f80358fbf56629a74f50d7f097af4b5f67626b0afce2d61/cua_driver-${DRIVER_VERSION}-py3-none-manylinux_2_31_aarch64.whl"

case "$(uname -m)" in
  x86_64) WHEEL="${WHEEL_X86_64}" ;;
  aarch64) WHEEL="${WHEEL_AARCH64}" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

SETUP="$(mktemp)"
trap 'rm -f "${SETUP}"' EXIT
cat > "${SETUP}" <<SETUP_SCRIPT
#!/usr/bin/env bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# Some hosts reach IPv4 only; every fetch here stays on it.
echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4
printf 'net.ipv6.conf.all.disable_ipv6=1\nnet.ipv6.conf.default.disable_ipv6=1\n' > /etc/sysctl.d/99-no-ipv6.conf
sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null || true

apt-get update
apt-get install -y --no-install-recommends \
  xvfb fluxbox xterm dbus-x11 x11-utils x11-xserver-utils \
  python3 python3-pip python3-venv ca-certificates curl fonts-dejavu-core \
  libxkbcommon0 libxcb1 libx11-6 libx11-xcb1 libxext6 libxrandr2 libxcomposite1 \
  libxcursor1 libxdamage1 libxfixes3 libxi6 libxtst6 libxss1 libglib2.0-0t64 \
  libnss3 libnspr4 libasound2t64 libgbm1 libdrm2 libxrender1 libcairo2 libpango-1.0-0

if ! id -u cua >/dev/null 2>&1; then
  if id -u ubuntu >/dev/null 2>&1; then
    usermod -l cua -d /home/cua -m ubuntu
    groupmod -n cua ubuntu 2>/dev/null || true
  else
    useradd -m -u 1000 -s /bin/bash cua
  fi
fi
install -d -o cua -g cua -m 0700 /run/user/1000
install -d -o cua -g cua /home/cua/.fluxbox
# Without a rootCommand, fluxbox opens an fbsetbg message box on every start, over the bot's screen.
printf 'session.screen0.rootCommand: /bin/true\n' > /home/cua/.fluxbox/init
chown cua:cua /home/cua/.fluxbox/init

python3 -m venv /opt/venv
/opt/venv/bin/pip install --no-cache-dir "${WHEEL}"
DRIVER_BIN="\$(find /opt/venv/lib -path '*/cua_driver/bin/cua-driver' -type f -print -quit)"
test -n "\${DRIVER_BIN}"
install -d -m 0755 /usr/local/libexec/openmausbot
install -m 0755 "\${DRIVER_BIN}" /usr/local/libexec/openmausbot/cua-driver
ln -sf /usr/local/libexec/openmausbot/cua-driver /usr/local/bin/cua-driver
/usr/local/libexec/openmausbot/cua-driver --version

cat > /usr/local/bin/start-openmausbot-desktop.sh <<'EOF'
#!/bin/sh
set -eu
export DISPLAY=:1
export XDG_RUNTIME_DIR=/run/user/1000
mkdir -p "\$XDG_RUNTIME_DIR"
chmod 700 "\$XDG_RUNTIME_DIR"
Xvfb :1 -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
attempt=0
until xset q >/dev/null 2>&1; do
  attempt=\$((attempt + 1))
  if [ "\$attempt" -ge 45 ]; then echo "X display :1 did not become ready" >&2; exit 1; fi
  sleep 1
done
fluxbox >/tmp/fluxbox.log 2>&1 &
xterm -geometry 100x28+40+40 >/dev/null 2>&1 &
exec env CUA_DRIVER_BROWSER_NO_SANDBOX=1 CUA_DRIVER_INSTALL_CHANNEL=python_package \\
  CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 NO_COLOR=1 \\
  /usr/local/libexec/openmausbot/cua-driver serve \\
  --socket /run/user/1000/openmausbot-cua.sock --permission-mode standard --cursor-reduced-motion on
EOF
chmod 0755 /usr/local/bin/start-openmausbot-desktop.sh

cat > /etc/systemd/system/openmausbot-desktop.service <<'EOF'
[Unit]
Description=OpenMausBot Cua desktop
After=network.target

[Service]
Type=simple
User=cua
Environment=HOME=/home/cua
Environment=USER=cua
Environment=DISPLAY=:1
# /run is a tmpfs in a fresh instance, so the runtime directory has to come from systemd, not the image.
RuntimeDirectory=user/1000
RuntimeDirectoryMode=0700
ExecStart=/usr/local/bin/start-openmausbot-desktop.sh
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openmausbot-desktop.service
systemctl start openmausbot-desktop.service
sleep 12
systemctl is-active openmausbot-desktop.service
ls -l /run/user/1000/
SETUP_SCRIPT

incus delete -f "${NAME}" 2>/dev/null || true
incus launch "${BASE}" "${NAME}"
incus file push "${SETUP}" "${NAME}/root/desktop-setup.sh"
incus exec "${NAME}" -- bash /root/desktop-setup.sh
incus stop "${NAME}"
incus publish "${NAME}" --alias "${ALIAS}" --reuse
incus image list "${ALIAS}" --format compact
echo "Use this image in Settings → Computers → Incus: ${ALIAS}"
