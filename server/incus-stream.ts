// Incus hands out a websocket per file descriptor instead of a child process, so the MCP bridge's
// "command" is this pump: stdin to the remote Cua Driver, its output back to stdout.
import { createIncusTransport, openIncusExec } from "./incus-client.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`missing ${name}\n`);
    process.exit(2);
  }
  return value;
}

const instance = required("OMB_INCUS_INSTANCE");
if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(instance)) {
  process.stderr.write("invalid Incus computer name\n");
  process.exit(2);
}
const uid = Number(process.env.OMB_INCUS_UID || "1000");
if (!Number.isInteger(uid) || uid < 0 || uid > 65535) {
  process.stderr.write("invalid Incus desktop uid\n");
  process.exit(2);
}
const transport = createIncusTransport({
  url: required("OMB_INCUS_URL"),
  clientCert: required("OMB_INCUS_CLIENT_CERT"),
  clientKey: required("OMB_INCUS_CLIENT_KEY"),
  serverCert: process.env.OMB_INCUS_SERVER_CERT || undefined,
  project: process.env.OMB_INCUS_PROJECT || "default",
});

const session = await openIncusExec(
  transport,
  instance,
  [required("OMB_INCUS_CUA_EXECUTABLE"), "mcp", "--socket", required("OMB_INCUS_CUA_SOCKET")],
  {
    uid,
    stdout: (data) => process.stdout.write(data),
    stderr: (data) => process.stderr.write(data),
  },
);

process.stdin.on("data", (chunk: Buffer) => {
  void session.write(chunk).catch((error: unknown) => {
    process.stderr.write(`Incus stream write failed: ${error instanceof Error ? error.message : String(error)}\n`);
    session.close();
  });
});
process.stdin.on("end", () => {
  void session.endInput().catch(() => {});
});
process.stdin.on("error", () => session.close());

const { code } = await session.done;
session.close();
process.exitCode = code;
