// Additions the Cua base image has no hook for: a working clipboard in the browser viewer, and the
// desktop's own folders living in the workspace the host already mounts.

/** Inlined into noVNC's page, because its UI binds no paste and cancels the browser's own Ctrl+V.
 * Single quotes only: this text becomes a Dockerfile heredoc, where a backtick would need escaping. */
export const CLIPBOARD_BRIDGE_JS = `import UI from './app/ui.js';

const CONTROL_L = 0xffe3;
const KEY_V = 0x76;

function toast(message, ms) {
  const label = document.createElement('div');
  label.textContent = message;
  label.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:99999',
    'padding:6px 10px', 'border-radius:8px', 'font:12px/1.4 system-ui,sans-serif',
    'background:rgba(20,20,20,.88)', 'color:#fff', 'pointer-events:none',
    'transition:opacity .3s', 'opacity:0',
  ].join(';');
  document.body.appendChild(label);
  requestAnimationFrame(function () { label.style.opacity = '1'; });
  setTimeout(function () { label.style.opacity = '0'; setTimeout(function () { label.remove(); }, 400); }, ms || 1800);
}

function editable(node) {
  if (!(node instanceof Element)) return false;
  return Boolean(node.closest('input, textarea, [contenteditable=""], [contenteditable="true"]'));
}

function keyboard() {
  return document.getElementById('noVNC_keyboardinput');
}

const announce = function () { toast('剪贴板桥接已启用', 2500); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce, { once: true });
else announce();

// A paste event only reaches the page while an editable element holds focus, and noVNC reads keys
// from a hidden textarea; keeping it focused is what makes Ctrl+V a paste at all.
document.addEventListener('mousedown', function (event) {
  if (editable(event.target)) return;
  const input = keyboard();
  if (input) input.focus();
}, true);

window.addEventListener('focus', function () {
  if (editable(document.activeElement)) return;
  const input = keyboard();
  if (input) input.focus();
});

// noVNC forwards keystrokes itself and cancels the browser default, so its Ctrl+V never becomes a
// paste. Stopping only that one combination hands the text to the handler below.
document.addEventListener('keydown', function (event) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'v') return;
  if (document.activeElement && document.activeElement.id === 'noVNC_clipboard_text') return;
  event.stopImmediatePropagation();
}, true);

document.addEventListener('paste', function (event) {
  const target = event.target;
  if (target && target.id === 'noVNC_clipboard_text') return;
  const text = event.clipboardData && event.clipboardData.getData('text');
  const rfb = UI.rfb;
  if (!text || !rfb) return;
  event.preventDefault();
  rfb.clipboardPasteFrom(text);
  const panel = document.getElementById('noVNC_clipboard_text');
  if (panel instanceof HTMLTextAreaElement) panel.value = text;
  toast('已发送 ' + text.length + ' 个字符到桌面剪贴板');
  // The desktop hears a real Ctrl+V, so the person does not paste twice.
  setTimeout(function () {
    rfb.sendKey(CONTROL_L, 'ControlLeft', true);
    rfb.sendKey(KEY_V, 'KeyV');
    rfb.sendKey(CONTROL_L, 'ControlLeft', false);
  }, 80);
});

// A plain http origin has no navigator.clipboard, so a copy from the desktop offers one button.
function copyLocally(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (error) {
    ok = false;
  }
  area.remove();
  toast(ok ? '已复制 ' + text.length + ' 个字符到本机剪贴板' : '浏览器拒绝了复制，请在面板里手动复制');
}

function offerCopy(text) {
  const previous = document.getElementById('omb-copy-offer');
  if (previous) previous.remove();
  const bar = document.createElement('div');
  bar.id = 'omb-copy-offer';
  bar.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:99999',
    'display:flex', 'align-items:center', 'gap:8px',
    'padding:6px 8px 6px 10px', 'border-radius:8px',
    'font:12px/1.4 system-ui,sans-serif',
    'background:rgba(20,20,20,.88)', 'color:#fff',
  ].join(';');
  const label = document.createElement('span');
  label.textContent = '桌面复制了 ' + text.length + ' 个字符';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '复制到本机';
  button.style.cssText = 'padding:2px 8px;border-radius:6px;border:0;cursor:pointer;font:12px/1.6 system-ui,sans-serif;background:#4c8dff;color:#fff';
  button.addEventListener('click', function () { copyLocally(text); bar.remove(); });
  bar.append(label, button);
  document.body.appendChild(bar);
  setTimeout(function () { bar.remove(); }, 20000);
}

let attached = null;
setInterval(function () {
  const rfb = UI.rfb;
  if (!rfb || rfb === attached) return;
  attached = rfb;
  rfb.addEventListener('clipboard', function (event) {
    const text = event.detail && event.detail.text;
    if (!text) return;
    const panel = document.getElementById('noVNC_clipboard_text');
    if (panel instanceof HTMLTextAreaElement) panel.value = text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('已复制 ' + text.length + ' 个字符到本机剪贴板');
      }, function () {
        offerCopy(text);
      });
      return;
    }
    offerCopy(text);
  });
}, 500);
`;

const BRIDGE_PATH = "/usr/local/share/openmausbot/clipboard-bridge.js";

/** The bridge and the desktop's shared folders, as Dockerfile steps after the base image's own setup. */
export function desktopTweaksDockerfile(): string {
  return `# The desktop's own folders are the workspace the host mounts, so a saved file needs no transfer.
RUN set -eux; \\
    install -d -o cua -g cua -m 0755 /home/cua/workspace/Downloads /home/cua/workspace/Desktop; \\
    ln -sfn /home/cua/workspace/Downloads /home/cua/Downloads; \\
    ln -sfn /home/cua/workspace/Desktop /home/cua/Desktop; \\
    chown -h cua:cua /home/cua/Downloads /home/cua/Desktop
# A fresh workspace arrives empty under the bind mount, so the targets are made before XFCE starts.
RUN printf '%s\\n' \\
      '#!/bin/sh' \\
      'install -d -o cua -g cua -m 0755 /home/cua/workspace/Downloads /home/cua/workspace/Desktop' \\
      > /usr/local/bin/openmausbot-share-folders.sh \\
    && chmod 0755 /usr/local/bin/openmausbot-share-folders.sh
RUN printf '%s\\n' \\
      '' \\
      '[program:openmausbot-share-folders]' \\
      'command=/usr/local/bin/openmausbot-share-folders.sh' \\
      'autorestart=false' \\
      'startsecs=0' \\
      'stdout_logfile=/var/log/supervisor/share-folders.log' \\
      'stderr_logfile=/var/log/supervisor/share-folders.error.log' \\
      'priority=5' \\
      >> /etc/supervisor/supervisord.conf
# Inlined into the page: a separate file would be one more thing a browser can cache stale.
RUN install -d /usr/local/share/openmausbot \\
    && cat > ${BRIDGE_PATH} <<'OPENMAUSBOT_BRIDGE'
${CLIPBOARD_BRIDGE_JS}OPENMAUSBOT_BRIDGE
RUN python3 -c "page='/usr/share/novnc/vnc.html'; html=open(page).read(); bridge=open('${BRIDGE_PATH}').read(); tag='<script type=\\"module\\">' + bridge + '</script>\\n'; open(page, 'w').write(html.replace('</body>', tag + '</body>'))" \\
    && grep -q "clipboardPasteFrom" /usr/share/novnc/vnc.html
# One published port carries every service: a second API is a location block, not a rebuilt container.
RUN set -eux; \\
    apt-get update; \\
    apt-get install -y --no-install-recommends nginx-light || apt-get install -y --no-install-recommends nginx; \\
    rm -rf /var/lib/apt/lists/*; \\
    rm -f /etc/nginx/sites-enabled/default
RUN cat > /etc/nginx/conf.d/openmausbot.conf <<'OPENMAUSBOT_NGINX'
server {
    listen 8765;
    server_name _;
    client_max_body_size 0;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # The bot's own console, when it runs one on loopback.
    location / {
        proxy_pass http://127.0.0.1:8766;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # A desktop with no service on 8766 still answers, saying how to add one.
    error_page 502 504 = @openmausbot_idle;
    location @openmausbot_idle {
        default_type text/plain;
        return 200 "OpenMausBot desktop proxy is running.\\nNothing answers on 8766 yet.\\nAdd your service with a location block in /etc/nginx/conf.d/ and reload nginx.\\n";
    }
}
OPENMAUSBOT_NGINX
RUN printf '%s\\n' \\
      '' \\
      '[program:openmausbot-nginx]' \\
      'command=/usr/sbin/nginx -g "daemon off;"' \\
      'autorestart=true' \\
      'startsecs=1' \\
      'stdout_logfile=/var/log/supervisor/nginx.log' \\
      'stderr_logfile=/var/log/supervisor/nginx.error.log' \\
      'priority=6' \\
      >> /etc/supervisor/supervisord.conf
`;
}
