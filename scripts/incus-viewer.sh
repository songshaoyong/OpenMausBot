#!/usr/bin/env bash
# A browser-usable view of one Incus desktop, for taking control by hand.
#
# The app itself has no live viewer for Incus computers, so this brings up the
# three pieces that make one: x11vnc inside the container, an Incus proxy device
# binding it to the WSL host's loopback, and websockify + noVNC on that host.
# Loopback only: nothing here listens on a network address.
set -Eeuo pipefail

instance="${1:-}"
if [[ -z "$instance" ]]; then
  echo "usage: $0 <incus-container>" >&2
  exit 2
fi
vnc_port="${VNC_PORT:-5901}"
# 6080 is the port the app reserves for a local VM's own viewer.
web_port="${WEB_PORT:-6081}"
sudo_cmd="${SUDO:-sudo}"

"$sudo_cmd" incus list "$instance" --format csv -c n >/dev/null 2>&1 || {
  echo "no such Incus instance: $instance" >&2
  exit 1
}

if ! "$sudo_cmd" incus exec "$instance" -- bash -c 'command -v x11vnc' >/dev/null 2>&1; then
  echo "installing x11vnc in $instance…"
  "$sudo_cmd" incus exec "$instance" -- bash -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq x11vnc'
fi

"$sudo_cmd" incus exec "$instance" -- pkill -x x11vnc >/dev/null 2>&1 || true
# -noshm -noxdamage: the container's Xvfb refuses SHM and XDamage.
"$sudo_cmd" incus exec "$instance" -- bash -c \
  'setsid x11vnc -display :1 -noshm -noxdamage -forever -shared -nopw -rfbport 5900 -o /tmp/x11vnc.log </dev/null >/dev/null 2>&1 &'

if ! "$sudo_cmd" incus config device show "$instance" | grep -q '^vncproxy:'; then
  "$sudo_cmd" incus config device add "$instance" vncproxy proxy \
    "listen=tcp:127.0.0.1:${vnc_port}" connect=tcp:127.0.0.1:5900
fi

if ! command -v websockify >/dev/null 2>&1 || [[ ! -f /usr/share/novnc/vnc.html ]]; then
  echo "installing noVNC and websockify on this host…"
  "$sudo_cmd" apt-get install -y -qq novnc websockify
fi

pkill -x websockify >/dev/null 2>&1 || true
setsid websockify --web /usr/share/novnc "127.0.0.1:${web_port}" "127.0.0.1:${vnc_port}" \
  </dev/null >/tmp/websockify.log 2>&1 &
sleep 2

echo "Viewer for $instance: http://127.0.0.1:${web_port}/vnc.html?autoconnect=1&resize=scale"
