// A stdio bridge into Cua Driver's MCP server inside an Incus computer. It defines no tools; the
// shared bridge only answers ping, makes tool schemas provider-safe and keeps error results text-only.
import { runMcpBridge } from "./mcp-bridge.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

// The who-is-driving pair rides in env, not argv, which `ps` shows to everyone; the token guards a loopback endpoint.
const controlUrl = process.env.OMB_CONTROL_URL ?? "";
const controlToken = process.env.OMB_CONTROL_TOKEN ?? "";

runMcpBridge({
  command: process.execPath,
  args: [SPAWNED_PROXIES.incusStream],
  label: "Cua Driver",
  ...(controlUrl && controlToken ? { gate: { url: controlUrl, token: controlToken } } : {}),
});
