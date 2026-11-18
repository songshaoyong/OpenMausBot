#!/usr/bin/env node
// Exposes a bot's Local VM to the network on Windows, where the container runtime reaches the host only
// on loopback. One process carries both links: the desktop's viewer page and the port its proxy serves.
//
//   node scripts/lan-relays.mjs <botId> <viewerLanPort> <serviceLanPort> [guestPort] [apiPort]
//
// The app publishes a random host port per container, so the targets are read from the app's own status
// every few seconds; a recreated desktop therefore keeps the same LAN address.
import net from "node:net";

const [botId, viewerLan, serviceLan, guestArg, apiArg] = process.argv.slice(2);
if (!botId || !viewerLan || !serviceLan) {
  console.error("usage: lan-relays.mjs <botId> <viewerLanPort> <serviceLanPort> [guestPort] [apiPort]");
  process.exit(2);
}

const guestPort = Number(guestArg ?? 8765);
const apiPort = Number(apiArg ?? process.env.OMB_PORT ?? 8799);
const statusUrl = `http://127.0.0.1:${apiPort}/api/bots/${botId}/local-computer`;

const targets = { viewer: 0, service: 0 };

async function refresh() {
  try {
    const status = await (await fetch(statusUrl)).json();
    if (Number.isInteger(status?.viewer_port) && status.viewer_port > 0) targets.viewer = status.viewer_port;
    const published = Array.isArray(status?.published_ports) ? status.published_ports : [];
    const match = published.find((entry) => entry.guest === guestPort);
    if (match && Number(match.host) > 0) targets.service = Number(match.host);
  } catch (error) {
    console.error(`status: ${error.message}`);
  }
}

function listen(lanPort, which) {
  net
    .createServer((client) => {
      const target = targets[which];
      if (!target) {
        client.destroy();
        return;
      }
      const upstream = net.connect(target, "127.0.0.1");
      client.pipe(upstream).pipe(client);
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
    })
    .listen(Number(lanPort), "0.0.0.0", () => {
      console.log(`${which}: 0.0.0.0:${lanPort} -> 127.0.0.1:<${which} port>`);
    });
}

await refresh();
setInterval(refresh, 5_000);
listen(viewerLan, "viewer");
listen(serviceLan, "service");
