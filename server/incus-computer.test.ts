import { describe, expect, it } from "vitest";

import {
  IncusError,
  withIncusProject,
  type IncusMethod,
  type IncusSocketHandlers,
  type IncusTransport,
} from "./incus-client.ts";
import {
  incusComputerAction,
  incusComputerFrame,
  incusComputerMcp,
  incusComputerStatus,
  incusImageSource,
  incusInstanceName,
  incusInstanceSpec,
  type IncusSettings,
} from "./incus-computer.ts";

const SETTINGS: IncusSettings = {
  url: "https://incus.test:8443",
  clientCert: "-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----",
  clientKey: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
  serverCert: "-----BEGIN CERTIFICATE-----\nserver\n-----END CERTIFICATE-----",
  project: "openmausbot",
};

const BOT_ID = "bot-1";

/** A truncated PNG transfer must be distinguishable from a whole one, so this crosses the size floor. */
function pngBytes(): Buffer {
  const png = Buffer.alloc(600);
  png.write("\x89PNG", 0, "binary");
  png.write("IEND", 590, "ascii");
  return png;
}

interface FakeOptions {
  instance?: { status: string } | null;
  exec?: (command: string[]) => { stdout?: string; code?: number };
}

function fakeIncus(options: FakeOptions = {}) {
  const calls: Array<{ method: IncusMethod; path: string; body?: unknown }> = [];
  let command: string[] = [];
  let exitCode = 0;
  const instance = options.instance === undefined ? { status: "Running" } : options.instance;

  const transport: IncusTransport = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      const bare = path.split("?")[0];
      if (/^\/1\.0\/operations\/[^/]+\/wait$/.test(bare)) {
        const code = bare.startsWith("/1.0/operations/exec/wait") ? exitCode : 0;
        return { metadata: { status_code: 200, metadata: { return: code } } };
      }
      if (method === "GET" && bare.startsWith("/1.0/instances/")) {
        if (!instance) throw new IncusError("Instance not found", 404);
        return { metadata: { name: decodeURIComponent(bare.split("/").pop() ?? ""), status: instance.status } };
      }
      if (method === "POST" && bare === "/1.0/instances") {
        return { metadata: {}, operation: "/1.0/operations/create" };
      }
      if (method === "POST" && bare.endsWith("/exec")) {
        command = (body as { command: string[] }).command;
        exitCode = options.exec?.(command)?.code ?? 0;
        return {
          metadata: { metadata: { fds: { "0": "stdin", "1": "stdout", "2": "stderr", control: "control" } } },
          operation: "/1.0/operations/exec",
        };
      }
      if (method === "PUT" || method === "DELETE") {
        return { metadata: {}, operation: "/1.0/operations/mutate" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    socket(path, handlers: IncusSocketHandlers) {
      const secret = new URL(path, "https://incus.test").searchParams.get("secret");
      const result = options.exec?.(command) ?? {};
      queueMicrotask(() => {
        if (secret === "stdout" && result.stdout) handlers.message(Buffer.from(result.stdout), false);
        handlers.close();
      });
      return Promise.resolve({ send: async () => {}, close: () => {} });
    },
  };
  return { transport, calls };
}

describe("Incus computer identity", () => {
  it("derives the instance name from a digest, never from the bot's own id", () => {
    expect(incusInstanceName(BOT_ID)).toBe(incusInstanceName(BOT_ID));
    expect(incusInstanceName(BOT_ID)).toMatch(/^openmausbot-incus-[a-f0-9]{16}$/);
    expect(incusInstanceName(BOT_ID)).not.toContain(BOT_ID);
    expect(incusInstanceName("bot-2")).not.toBe(incusInstanceName(BOT_ID));
  });

  it("splits a registry reference into the OCI server and image name", () => {
    expect(incusImageSource("docker.io/trycua/xfce-cua")).toEqual({
      server: "https://docker.io",
      alias: "trycua/xfce-cua",
    });
    expect(incusImageSource("trycua/xfce-cua")).toEqual({
      server: "https://docker.io",
      alias: "trycua/xfce-cua",
    });
    expect(incusImageSource("localhost:5000/openmausbot/desktop")).toEqual({
      server: "https://localhost:5000",
      alias: "openmausbot/desktop",
    });
    expect(incusImageSource("openmausbot-desktop")).toBeNull();
    expect(incusInstanceSpec({ ...SETTINGS, image: "openmausbot-desktop" }, BOT_ID, "i")).toMatchObject({
      source: { type: "image", alias: "openmausbot-desktop" },
    });
  });

  it("pins the Cua desktop's hard limits on the instance, not on a profile", () => {
    const spec = incusInstanceSpec(SETTINGS, BOT_ID, "instance-1") as {
      type: string;
      source: { type: string; protocol: string };
      config: Record<string, string>;
    };
    expect(spec.type).toBe("container");
    expect(spec.source).toMatchObject({ type: "image", protocol: "oci" });
    expect(spec.config["security.privileged"]).toBe("false");
    expect(spec.config["security.idmap.isolated"]).toBe("true");
    expect(spec.config["limits.cpu"]).toBe("2");
    expect(spec.config["limits.memory"]).toBe("4GiB");
  });
});

describe("Incus computer status", () => {
  it("reports a missing instance without inventing a failure", async () => {
    const { transport } = fakeIncus({ instance: null });
    const status = await incusComputerStatus(SETTINGS, BOT_ID, { transport });
    expect(status.state).toBe("missing");
    expect(status.ready).toBe(false);
    expect(status.problem).toBe("No Incus computer exists for this bot yet");
  });

  it("is ready only once the Cua socket inside the instance answers", async () => {
    const answered = fakeIncus({ exec: () => ({ code: 0 }) });
    expect((await incusComputerStatus(SETTINGS, BOT_ID, { transport: answered.transport })).ready).toBe(true);

    const silent = fakeIncus({ exec: () => ({ code: 1 }) });
    const status = await incusComputerStatus(SETTINGS, BOT_ID, { transport: silent.transport });
    expect(status.state).toBe("running");
    expect(status.desktopReady).toBe(false);
    expect(status.problem).toContain("/run/user/1000/openmausbot-cua.sock");
  });

  it("names the socket the image actually has when the default is missing", async () => {
    const { transport } = fakeIncus({ exec: () => ({ code: 1, stdout: "/run/user/1000/cua.sock\n" }) });
    const status = await incusComputerStatus(SETTINGS, BOT_ID, { transport });
    expect(status.ready).toBe(false);
    expect(status.problem).toContain("/run/user/1000/cua.sock");
    expect(status.problem).toContain("incus.cuaSocket");
  });

  it("scopes every request to the configured project", () => {
    expect(withIncusProject("/1.0/instances", "openmausbot")).toBe("/1.0/instances?project=openmausbot");
    expect(withIncusProject("/1.0/instances?recursion=1", "openmausbot")).toBe(
      "/1.0/instances?recursion=1&project=openmausbot",
    );
  });

  it("does not call Incus at all when it is not configured", async () => {
    const { transport, calls } = fakeIncus();
    const status = await incusComputerStatus({ ...SETTINGS, clientCert: "" }, BOT_ID, { transport });
    expect(status.configured).toBe(false);
    expect(status.problem).toContain("Settings");
    expect(calls).toEqual([]);
  });
});

describe("Incus computer lifecycle", () => {
  it("creates the instance from the OCI image and waits for the operation", async () => {
    const { transport, calls } = fakeIncus({ instance: null });
    const result = await incusComputerAction(SETTINGS, BOT_ID, "provision", { transport });
    expect(result).toEqual({ created: true, state: "running" });
    const create = calls.find((call) => call.method === "POST" && call.path === "/1.0/instances");
    expect(create?.body).toMatchObject({ type: "container", source: { protocol: "oci" } });
    expect(calls.some((call) => call.path.startsWith("/1.0/operations/create/wait"))).toBe(true);
  });

  it("starts an existing stopped instance instead of creating a second one", async () => {
    const { transport, calls } = fakeIncus({ instance: { status: "Stopped" } });
    const result = await incusComputerAction(SETTINGS, BOT_ID, "provision", { transport });
    expect(result.created).toBe(false);
    expect(calls.filter((call) => call.method === "POST" && call.path === "/1.0/instances")).toEqual([]);
    expect(calls.some((call) => call.method === "PUT" && call.path.includes("/state"))).toBe(true);
  });

  it("removes by stopping first and deleting after", async () => {
    const { transport, calls } = fakeIncus();
    const result = await incusComputerAction(SETTINGS, BOT_ID, "remove", { transport });
    expect(result.state).toBe("missing");
    const mutating = calls.filter((call) => call.method === "PUT" || call.method === "DELETE");
    expect(mutating[0].method).toBe("PUT");
    expect(mutating.at(-1)?.method).toBe("DELETE");
  });

  it("treats an already-absent instance as removed", async () => {
    const { transport } = fakeIncus({ instance: null });
    await expect(incusComputerAction(SETTINGS, BOT_ID, "remove", { transport })).resolves.toEqual({
      created: false,
      state: "missing",
    });
  });
});

describe("Incus computer screen", () => {
  it("asks Cua Driver for the screen and reads the file back whole", async () => {
    const png = pngBytes();
    const { transport, calls } = fakeIncus({
      exec: (command) =>
        command[0] === "base64" ? { stdout: png.toString("base64"), code: 0 } : { code: 0 },
    });
    const frame = await incusComputerFrame(SETTINGS, BOT_ID, { transport });
    expect(frame).toEqual({ png: png.toString("base64"), format: "png" });
    const driverCall = calls.find((call) => call.path.endsWith("/exec"));
    expect(JSON.stringify(driverCall?.body)).toContain("get_desktop_state");
    expect(JSON.stringify(driverCall?.body)).toContain("--screenshot-out-file");
  });

  it("refuses a screenshot the driver did not produce", async () => {
    const { transport } = fakeIncus({
      exec: (command) =>
        command[0] === "base64" ? { stdout: Buffer.alloc(4).toString("base64"), code: 0 } : { code: 0 },
    });
    await expect(incusComputerFrame(SETTINGS, BOT_ID, { transport })).rejects.toThrow(/incomplete screenshot/);
  });
});

describe("Incus computer MCP launch", () => {
  it("keeps the certificate out of argv and adds the control pair only when given", () => {
    const launch = incusComputerMcp(SETTINGS, BOT_ID);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args.at(-1)).toMatch(/incus-container-mcp\.(ts|js)$/);
    expect(launch.args.join(" ")).not.toContain("BEGIN CERTIFICATE");
    expect(launch.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      OMB_INCUS_URL: SETTINGS.url,
      OMB_INCUS_INSTANCE: incusInstanceName(BOT_ID),
      OMB_INCUS_PROJECT: "openmausbot",
    });
    expect(launch.env.OMB_CONTROL_TOKEN).toBeUndefined();

    const gated = incusComputerMcp(SETTINGS, BOT_ID, { url: "http://127.0.0.1:1/x", token: "t" });
    expect(gated.env.OMB_CONTROL_TOKEN).toBe("t");
  });
});
