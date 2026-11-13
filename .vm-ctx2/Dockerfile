FROM docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b
USER root
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64) wheel_url='https://files.pythonhosted.org/packages/3b/b0/97f6d8828b8a6ca3649ad7150ddbc23addde56f014c9bd407876484ecb8d/cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl'; wheel_sha='e530ee36226d99516ef7ec696ba31d516e487ae5e5effdd5e2610c56af3eee19'; wheel_path='/tmp/cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl'; lib_triplet='x86_64-linux-gnu' ;; \
      aarch64|arm64) wheel_url='https://files.pythonhosted.org/packages/dc/33/81e2531353837f80358fbf56629a74f50d7f097af4b5f67626b0afce2d61/cua_driver-0.37.0-py3-none-manylinux_2_31_aarch64.whl'; wheel_sha='1a0103fd7fa5e9d51ee3ce26d502eb4187702282b3f4bcf1e9c09c6ce9f9d558'; wheel_path='/tmp/cua_driver-0.37.0-py3-none-manylinux_2_31_aarch64.whl'; lib_triplet='aarch64-linux-gnu' ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    for ssl_lib in "/lib/$lib_triplet/libssl.so.3" "/lib/$lib_triplet/libcrypto.so.3"; do \
      if [ -e "$ssl_lib" ] && [ ! -s "$ssl_lib" ]; then \
        echo "pinned base image is defective on $arch: $ssl_lib is zero bytes, so curl cannot start — re-pull or replace the base image instead of debugging the wheel download" >&2; \
        exit 1; \
      fi; \
    done; \
    curl -fsSL "$wheel_url" -o "$wheel_path"; \
    echo "$wheel_sha  $wheel_path" | sha256sum -c -; \
    /opt/venv/bin/python -m pip install --no-cache-dir --force-reinstall --no-deps "$wheel_path"; \
    rm -f "$wheel_path"; \
    driver_bin="$(find /opt/venv/lib -path '*/cua_driver/bin/cua-driver' -type f -print -quit)"; \
    test -n "$driver_bin"; \
    install -D -m 0755 "$driver_bin" /usr/local/libexec/openmausbot/cua-driver; \
    install -d -o cua -g cua -m 0700 /home/cua/workspace; \
    test "$(/usr/local/libexec/openmausbot/cua-driver --version)" = "cua-driver 0.37.0"
# Install before XFCE starts so the panel and window manager see the font too.
COPY NotoSansCJKjp-Regular.otf /usr/local/share/fonts/NotoSansCJKjp-Regular.otf
COPY OFL.txt /usr/local/share/licenses/noto-cjk/OFL.txt
RUN set -eux; \
    echo '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5  /usr/local/share/fonts/NotoSansCJKjp-Regular.otf' | sha256sum -c -; \
    chmod 0644 /usr/local/share/fonts/NotoSansCJKjp-Regular.otf; \
    echo '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2  /usr/local/share/licenses/noto-cjk/OFL.txt' | sha256sum -c -; \
    fc-cache -f
RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -eu' \
      'workspace=/home/cua/workspace' \
      'profiles="$workspace/.browser-profiles"' \
      'apps="$workspace/.desktop-apps"' \
      'mkdir -p "$profiles/google-chrome" "$profiles/chromium" "$profiles/mozilla" "$apps/local" "$HOME/.config" "$HOME/.cache"' \
      'if ! chmod 0700 "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium" "$profiles/mozilla" 2>/dev/null; then' \
      '  for directory in "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium" "$profiles/mozilla"; do' \
      '    test -r "$directory" && test -w "$directory" && test -x "$directory"' \
      '  done' \
      'fi' \
      'migrate_profile() {' \
      '  source="$1"' \
      '  target="$profiles/$2"' \
      '  if [ -d "$source" ] && [ ! -L "$source" ] && [ -z "$(find "$target" -mindepth 1 -print -quit)" ]; then' \
      '    cp -a "$source"/. "$target"/' \
      '  fi' \
      '  rm -rf "$source"' \
      '  ln -s "$target" "$source"' \
      '}' \
      'migrate_profile "$HOME/.config/google-chrome" google-chrome' \
      'migrate_profile "$HOME/.config/chromium" chromium' \
      'migrate_profile "$HOME/.mozilla" mozilla' \
      'if [ -d "$HOME/.local" ] && [ ! -L "$HOME/.local" ] && [ -z "$(find "$apps/local" -mindepth 1 -print -quit)" ]; then' \
      '  cp -a "$HOME/.local"/. "$apps/local"/' \
      'fi' \
      'rm -rf "$HOME/.local"' \
      'ln -s "$apps/local" "$HOME/.local"' \
      'container_start="$(cat /proc/sys/kernel/random/boot_id):$(sed "s/.*) //" /proc/1/stat | cut -d " " -f20)"' \
      'prepared="$HOME/.cache/openmausbot-browser-locks"' \
      'if [ "$(cat "$prepared" 2>/dev/null || true)" != "$container_start" ]; then' \
      '  find "$profiles" \( -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie -o -name .parentlock -o -name lock -type l \) -delete' \
      '  printf "%s\n" "$container_start" > "$prepared"' \
      'fi' \
      > /usr/local/bin/prepare-openmausbot-workspace.sh \
    && chmod 0755 /usr/local/bin/prepare-openmausbot-workspace.sh
# A bot's own desktop: a 200 ms (not 800) watch for windows an action opens still sees Firefox popups; no cursor glide; plain logs; Chrome's own sandbox off, since it needs namespaces this hardened container (capabilities dropped, runtime seccomp) refuses and Chrome exits with code 21; the container is the isolation boundary here.
RUN printf '%s\n' \
      '#!/bin/sh' \
      '/usr/local/bin/prepare-openmausbot-workspace.sh' \
      'attempt=0' \
      'until DISPLAY=:1 xset q >/dev/null 2>&1; do' \
      '  attempt=$((attempt + 1))' \
      '  if [ "$attempt" -ge 45 ]; then echo "X display :1 did not become ready within 45 seconds" >&2; exit 1; fi' \
      '  sleep 1' \
      'done' \
      'exec env CUA_DRIVER_BROWSER_NO_SANDBOX=1 CUA_DRIVER_INSTALL_CHANNEL=python_package CUA_DRIVER_RS_TELEMETRY_ENABLED=0 CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=200 NO_COLOR=1 /usr/local/libexec/openmausbot/cua-driver serve --socket /run/user/1000/openmausbot-cua.sock --permission-mode standard --cursor-reduced-motion on' \
      > /usr/local/bin/start-openmausbot-cua-driver.sh \
    && chmod 0755 /usr/local/bin/start-openmausbot-cua-driver.sh
RUN printf '%s\n' \
      '' \
      '[program:openmausbot-cua-driver]' \
      'command=/usr/local/bin/start-openmausbot-cua-driver.sh' \
      'user=cua' \
      'environment=HOME="/home/cua",USER="cua",DISPLAY=":1"' \
      'autorestart=true' \
      'startsecs=2' \
      'stdout_logfile=/var/log/supervisor/cua-driver.log' \
      'stderr_logfile=/var/log/supervisor/cua-driver.error.log' \
      'priority=30' \
      >> /etc/supervisor/supervisord.conf
LABEL com.openmausbot.local-vm="1" \
      com.openmausbot.cua-driver="0.37.0" \
      com.openmausbot.cua-base="sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b" \
      com.openmausbot.image-layer="8"
