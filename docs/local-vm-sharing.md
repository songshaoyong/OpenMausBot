# Sharing a bot's private desktop

A Local VM is a container behind its own network namespace: nothing inside it is reachable from another
machine until four separate things line up. This page is the whole chain, in order, so a new computer can
be set up once and stay working.

```
VM service (0.0.0.0:8765)
  1. container port published     podman -p  -> 127.0.0.1:<random>   (localVm.publish)
  2. WSL relay                    the Windows host sees loopback only
  3. host relay                   scripts/lan-relays.mjs -> 0.0.0.0:<LAN port>
  4. firewall                     one inbound rule for the LAN port
```

The desktop's own tools already ride on this: `nginx` listens on the published port inside the image and
routes by path, so a second service is a `location` block instead of a rebuilt container.

## 1. Publish the port

`~/.openmausbot/config.json` (or `PATCH /api/config`):

```jsonc
"localVm": {
  "mode": "per-bot",
  "maxInstances": 4,
  "publish": [{ "guest": 8765 }],   // guest only: the host port is chosen per container, so bots never collide
  "share": { "baseUrl": "http://192.168.66.247", "viewerPort": 6902, "servicePort": 8765 }
}
```

- `publish` maps container ports onto the host. Leave `host` out in per-bot mode; a fixed host port makes
  the second desktop fail to start with `address already in use`.
- `share` is only what the 分享 button copies — `baseUrl` is this machine's LAN address and the two ports
  are what the relays below listen on. Without it the button is hidden.

Publishing only takes effect on a **new** container: remove and re-create the desktop from the screen
panel. `/home/cua/workspace` survives; the container's own files and the VNC password do not.

## 2. Run the relays on the host

```powershell
node scripts/lan-relays.mjs <botId> 6902 8765
```

It reads `viewer_port` and `published_ports` from `/api/bots/<botId>/local-computer` every five seconds, so
re-created desktops keep the same LAN addresses. To start it at sign-in, put a shortcut to that command in
`shell:startup`.

## 3. Open the firewall (Windows, Public profile)

```powershell
New-NetFirewallRule -DisplayName "OpenMausBot Local VM 6902" -Direction Inbound -Protocol TCP -LocalPort 6902 -Action Allow -Profile Public
New-NetFirewallRule -DisplayName "OpenMausBot Local VM 8765" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Public
```

## 4. Add services behind the published port

Inside the desktop, a service should bind `0.0.0.0` (or the container address), never `127.0.0.1`: the
published port is forwarded to the container's interface, not to its loopback.

```nginx
# /etc/nginx/conf.d/mine.conf
location /pyapi/ { proxy_pass http://127.0.0.1:8000/; proxy_buffering off; }
```

```sh
nginx -s reload
```

Anything that ends up on `127.0.0.1:8766` is already served at `/`, because that is where the desktop's
own console runs.

## What the bot knows

The system prompt tells the bot that `/home/cua/workspace` is the person's folder on the host, that a
share link is created by the person (not by the bot), and that a service it starts needs a published port
and a `0.0.0.0` bind. It will not invent an address.

## Checks

```powershell
podman port openmausbot-computer-<hash>          # 8765/tcp -> 0.0.0.0:<random>
curl http://127.0.0.1:<random>/                  # nginx or the console, from the host
curl http://<lan-ip>:8765/                       # through the relay
curl http://<lan-ip>:6902/vnc.html               # the desktop page
```

`GET /api/bots/<id>/local-computer` returns `share.viewer` with the password the container has right now —
the share button copies exactly that, so a link never goes stale.
