# Incus computers

Two parts: what the transport fixture proves without an Incus server, and the
recipe that needs a real one.

## Transport and provider

```sh
pnpm exec vitest run server/incus-transport.test.ts server/incus-computer.test.ts server/proxy-paths.test.ts
```

`server/incus-transport.test.ts` starts a real HTTPS server that demands a
client certificate, with a real websocket upgrade per file descriptor. It
proves the wire, not a stub: an exec collects stdout from the `1` socket and
the command's own exit code from the operation, file reads come back whole
through base64, a client with no certificate is refused, a server whose
certificate is not the pinned one is refused, and a self-signed server is not
trusted until its certificate is supplied. The certificate pair in
`server/testing/incus-tls.ts` is throwaway test material.

`server/incus-computer.test.ts` covers the provider against the same transport
interface: digest-derived instance names, the OCI image source split, the
`security.idmap.isolated` and `limits.*` the instance pins itself, missing
versus ready status, provisioning an existing stopped instance without a
second create, stop-then-delete order, a refused truncated screenshot, and the
MCP launch that keeps certificates out of argv.

## Against a real Incus server

Needs Incus 6.11 or newer (OCI image sources) on the same machine as the
Docker deployment.

```sh
sudo incus config set core.https_address :8443
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
  -keyout client.key -out client.crt -subj "/CN=openmausbot" -addext "extendedKeyUsage=clientAuth"
incus config trust add-certificate client.crt --name openmausbot
sudo cat /var/lib/incus/server.crt > server.crt
```

Paste `https://host.docker.internal:8443`, the project, `client.crt`,
`client.key` and `server.crt` into **Settings → Computers → Incus**, then give a
bot **Cloud → Incus** and open its Screen panel.

What to record, in order, so the receipt shows both the action and the state:

1. `incus list` before, then the panel's first screenshot: the instance
   `openmausbot-incus-<digest>` appears as `RUNNING`.
2. `incus exec openmausbot-incus-<digest> -- ls /run/user/1000/`: the Cua
   socket exists (by default `/run/user/1000/openmausbot-cua.sock`, or the
   server's `incus.cuaSocket`), which is what the panel's readiness probe
   checks.
3. One bot turn that uses the computer and its screenshot in the transcript.
4. `incus stop` from the panel, then `incus list`: `STOPPED`, not deleted.
5. The card's trash button, confirmed by name: the instance is gone from
   `incus list`, and a bot whose turn still needs it reports a clear refusal
   rather than a 500.

2026-11-10, Incus 7.6 on WSL2 Ubuntu, through the provider itself
(`incusComputerStatus` → `provision` → `status` → `frame`): the instance was
created from a locally published alias, reported running with
`desktopReady: true` five seconds later, and `get_desktop_state` returned a
whole 24 KB PNG of the fluxbox desktop with its terminal. An MCP
`initialize`/`tools/list` against the same instance through
`server/incus-container-mcp.ts` returned `cua-driver 0.37.0` and its tool list.
The same run found and fixed three things the stubs could not: Incus rejects
config keys outside `user.*` for the owner marker, `exec` takes numeric ids
rather than names, and `/run/user/1000` must come from the unit's
`RuntimeDirectory` because `/run` is a fresh tmpfs in every instance.

On this host `docker.io` was unreachable, so the desktop came from
`scripts/incus-desktop-image.sh` rather than a registry pull; a deployment that
can pull needs only the image reference. The panel has no browser desktop
viewer for this backend; it shows screen previews and the bot drives the
desktop through its Cua tools.

Keep the panel's response bodies, the `incus list` output before and after, and
the server log path.
