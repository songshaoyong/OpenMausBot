// The Incus transport itself, against a real HTTPS server that demands a client certificate: exec is one
// websocket per file descriptor, so a stub request object would prove nothing about the wire.
import { randomUUID } from "node:crypto";
import { createServer, request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { createIncusTransport, incusExec, incusReadFile, type IncusTransport } from "./incus-client.ts";
import { INCUS_DECOY_CERT, INCUS_TEST_CERT, INCUS_TEST_KEY } from "./testing/incus-tls.ts";

interface ExecRecord {
  command: string[];
  secrets: Record<string, string>;
  stdout: string;
  code: number;
}

interface FakeIncus {
  port: number;
  requests: string[];
  execs: ExecRecord[];
  close(): Promise<void>;
}

const ROLE_FDS: Array<[string, string]> = [
  ["0", "stdin"],
  ["1", "stdout"],
  ["2", "stderr"],
  ["control", "control"],
];

async function fakeIncus(): Promise<FakeIncus> {
  const requests: string[] = [];
  const execs: ExecRecord[] = [];
  const roles = new Map<string, string>();
  const exitCodes = new Map<string, number>();
  const screenshot = Buffer.from("whole screenshot bytes");

  const server = createServer(
    { key: INCUS_TEST_KEY, cert: INCUS_TEST_CERT, ca: INCUS_TEST_CERT, requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      const url = req.url ?? "/";
      const path = url.split("?")[0];
      requests.push(`${req.method} ${url}`);
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const send = (body: unknown, status = 200) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.method === "POST" && path.endsWith("/exec")) {
          const command = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { command: string[] }).command;
          const stdout = command[0] === "base64" ? screenshot.toString("base64") : command.join(" ");
          const secrets: Record<string, string> = {};
          for (const [fd, role] of ROLE_FDS) {
            const secret = randomUUID();
            secrets[fd] = secret;
            roles.set(secret, role);
          }
          const id = `op-${execs.length + 1}`;
          const code = command[0] === "false" ? 3 : 0;
          execs.push({ command, secrets, stdout, code });
          exitCodes.set(id, code);
          return send({
            type: "async",
            operation: `/1.0/operations/${id}`,
            metadata: { id, metadata: { fds: secrets } },
          });
        }
        if (req.method === "GET" && /^\/1\.0\/operations\/[^/]+\/wait/.test(path)) {
          const id = path.split("/")[3];
          return send({ type: "sync", metadata: { status_code: 200, metadata: { return: exitCodes.get(id) ?? 0 } } });
        }
        if (req.method === "GET" && path.startsWith("/1.0/instances/")) {
          return send({ type: "sync", metadata: { name: "openmausbot-incus-1", status: "Running" } });
        }
        if (req.method === "POST" && path.startsWith("/1.0/instances")) {
          return send({ type: "async", operation: "/1.0/operations/create", metadata: {} });
        }
        if (req.method === "PUT" || req.method === "DELETE") {
          return send({ type: "async", operation: "/1.0/operations/mutate", metadata: {} });
        }
        return send({ type: "error", error: "unexpected route", error_code: 404 }, 404);
      });
    },
  );

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const secret = new URL(req.url ?? "/", "https://incus.test").searchParams.get("secret") ?? "";
    const role = roles.get(secret) ?? "";
    wss.handleUpgrade(req, socket, head, (ws) => {
      const exec = execs[execs.length - 1];
      if (role === "stdout") {
        ws.send(exec.stdout);
        setTimeout(() => ws.close(), 5);
      } else if (role === "stderr") {
        setTimeout(() => ws.close(), 5);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    requests,
    execs,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function transportFor(fake: FakeIncus, serverCert: string | null = INCUS_TEST_CERT): Promise<IncusTransport> {
  closers.push(fake.close);
  return createIncusTransport({
    url: `https://127.0.0.1:${fake.port}`,
    clientCert: INCUS_TEST_CERT,
    clientKey: INCUS_TEST_KEY,
    ...(serverCert ? { serverCert } : {}),
    project: "omb",
  });
}

describe("Incus transport", () => {
  it("runs a command over mutual TLS and collects the output from its websockets", async () => {
    const fake = await fakeIncus();
    const transport = await transportFor(fake);
    const result = await incusExec(transport, "openmausbot-incus-1", ["echo", "hi"]);
    expect(result).toMatchObject({ code: 0, stdout: "echo hi", timedOut: false });
    expect(fake.execs[0].command).toEqual(["echo", "hi"]);
    expect(fake.requests.every((entry) => entry.includes("project=omb"))).toBe(true);
  });

  it("reports the command's own exit code", async () => {
    const fake = await fakeIncus();
    const transport = await transportFor(fake);
    const result = await incusExec(transport, "openmausbot-incus-1", ["false"]);
    expect(result.code).toBe(3);
  });

  it("reads a file back through base64", async () => {
    const fake = await fakeIncus();
    const transport = await transportFor(fake);
    const bytes = await incusReadFile(transport, "openmausbot-incus-1", "/tmp/shot.png");
    expect(bytes.toString("utf8")).toBe("whole screenshot bytes");
    expect(fake.execs[0].command).toEqual(["base64", "-w0", "/tmp/shot.png"]);
  });

  it("refuses a client that presents no certificate", async () => {
    const fake = await fakeIncus();
    closers.push(fake.close);
    await expect(
      new Promise((resolve, reject) => {
        const request = httpsRequest(
          { host: "127.0.0.1", port: fake.port, path: "/1.0/instances", rejectUnauthorized: false },
          (response) => resolve(response.statusCode),
        );
        request.on("error", reject);
        request.end();
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects a server whose certificate is not the pinned one", async () => {
    const fake = await fakeIncus();
    const transport = await transportFor(fake, INCUS_DECOY_CERT);
    await expect(transport.request("GET", "/1.0/instances/x")).rejects.toThrow(/certificate/i);
  });

  it("does not trust a self-signed server until its certificate is supplied", async () => {
    const fake = await fakeIncus();
    const transport = await transportFor(fake, null);
    await expect(transport.request("GET", "/1.0/instances/x")).rejects.toThrow();
  });
});
