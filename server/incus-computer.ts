// An Incus computer: one OCI application container per bot on an Incus server we reach over HTTPS.
// The image is the Cua XFCE desktop, so the bot's screen work is Cua Driver's, exactly as in the Local VM.
import { createHash } from "node:crypto";

import { BASE_IMAGE, wholeScreenshot } from "./container-computer.ts";
import {
  createIncusTransport,
  incusExec,
  incusInstancePath,
  incusOperationError,
  incusOperationSucceeded,
  incusReadFile,
  isIncusStatus,
  waitIncusOperation,
  type IncusConnection,
  type IncusExecOptions,
  type IncusResponse,
  type IncusTransport,
} from "./incus-client.ts";
import type { AppConfig } from "./config.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

export const INCUS_INSTANCE_PREFIX = "openmausbot-incus";
/** Incus accepts only its own keys plus `user.*`, so the owner marker lives under that prefix. */
export const INCUS_COMPUTER_LABEL = "user.openmausbot.incus-computer";
export const INCUS_DESKTOP_UID = 1000;
export const INCUS_CUA_SOCKET = "/run/user/1000/openmausbot-cua.sock";
export const INCUS_CUA_EXECUTABLE = "cua-driver";

const CREATE_TIMEOUT_MS = 180_000;
const LIFECYCLE_TIMEOUT_MS = 120_000;
const SCREENSHOT_PATH = "/tmp/openmausbot-preview.png";

/** Everything the provider needs, already validated; the App Settings schema owns the defaults. */
export interface IncusSettings {
  url: string;
  clientCert: string;
  clientKey: string;
  serverCert?: string;
  project: string;
  image?: string;
  cuaExecutable?: string;
  cuaSocket?: string;
  uid?: number;
  cpus?: number;
  memory?: string;
  processes?: number;
}

export interface IncusDeps {
  transport?: IncusTransport;
}

/** Absent means "not configured"; the schema validates shape only, so defaults live here. */
export function incusSettings(cfg: AppConfig): IncusSettings | undefined {
  const incus = cfg.incus;
  if (!incus?.url || !incus.clientCert || !incus.clientKey) return undefined;
  return {
    url: incus.url,
    clientCert: incus.clientCert,
    clientKey: incus.clientKey,
    project: incus.project || "default",
    ...(incus.serverCert ? { serverCert: incus.serverCert } : {}),
    ...(incus.image ? { image: incus.image } : {}),
    ...(incus.cuaExecutable ? { cuaExecutable: incus.cuaExecutable } : {}),
    ...(incus.cuaSocket ? { cuaSocket: incus.cuaSocket } : {}),
    ...(incus.uid !== undefined ? { uid: incus.uid } : {}),
    ...(incus.cpus ? { cpus: incus.cpus } : {}),
    ...(incus.memory ? { memory: incus.memory } : {}),
    ...(incus.processes ? { processes: incus.processes } : {}),
  };
}

export function incusConnection(settings: IncusSettings): IncusConnection {
  return {
    url: settings.url,
    clientCert: settings.clientCert,
    clientKey: settings.clientKey,
    serverCert: settings.serverCert,
    project: settings.project,
  };
}

export function incusConfigured(settings: IncusSettings | undefined): settings is IncusSettings {
  return Boolean(settings?.url && settings.clientCert && settings.clientKey);
}

function transportFor(settings: IncusSettings, deps: IncusDeps): IncusTransport {
  return deps.transport ?? createIncusTransport(incusConnection(settings));
}

/** Identities come from a digest, never a bot's display name or a caller-controlled path fragment. */
export function incusInstanceName(botId: string): string {
  return `${INCUS_INSTANCE_PREFIX}-${createHash("sha256").update(botId).digest("hex").slice(0, 16)}`;
}

/**
 * Splits a registry reference into the OCI server and image name an Incus image source takes.
 * A single-segment name is an alias of an image already on the server (`incus publish`), not a registry path.
 */
export function incusImageSource(image: string): { server: string; alias: string } | null {
  if (!image.includes("/")) return null;
  const slash = image.indexOf("/");
  const registry = image.slice(0, slash);
  if (registry.includes(".") || registry.includes(":") || registry === "localhost") {
    return { server: `https://${registry}`, alias: image.slice(slash + 1) };
  }
  return { server: "https://docker.io", alias: image };
}

export function incusInstanceSpec(
  settings: IncusSettings,
  botId: string,
  name: string,
): Record<string, unknown> {
  const image = settings.image ?? BASE_IMAGE;
  const oci = incusImageSource(image);
  return {
    name,
    type: "container",
    // Not ephemeral: stop and start keep the bot's installed tools and files on the instance's own disk.
    ephemeral: false,
    start: true,
    source: oci ? { type: "image", protocol: "oci", ...oci } : { type: "image", alias: image },
    config: {
      [INCUS_COMPUTER_LABEL]: botId,
      "limits.cpu": String(settings.cpus ?? 2),
      "limits.memory": settings.memory ?? "4GiB",
      "limits.processes": String(settings.processes ?? 2048),
      // Set on the instance so a profile cannot loosen them; an isolated id map keeps every
      // computer's host uid range apart from the others and from the server's own containers.
      "security.privileged": "false",
      "security.nesting": "false",
      "security.idmap.isolated": "true",
    },
  };
}

export type IncusComputerState = "missing" | "stopped" | "starting" | "running" | "error" | "unknown";

export interface IncusComputerStatus {
  configured: boolean;
  instance: string;
  image: string;
  state: IncusComputerState;
  /** The Cua socket inside the instance answers, so screen work can start. */
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
}

interface IncusInstance {
  name?: string;
  status?: string;
  status_code?: number;
  config?: Record<string, string>;
}

function stateOf(status: string | undefined): IncusComputerState {
  switch (status) {
    case undefined:
      return "unknown";
    case "Running":
      return "running";
    case "Starting":
      return "starting";
    case "Stopped":
    case "Frozen":
      return "stopped";
    case "Error":
      return "error";
    default:
      return "unknown";
  }
}

async function readInstance(
  transport: IncusTransport,
  name: string,
): Promise<IncusInstance | undefined> {
  try {
    const { metadata } = await transport.request("GET", `${incusInstancePath(name)}?recursion=1`);
    return (metadata ?? {}) as IncusInstance;
  } catch (error) {
    if (isIncusStatus(error, 404)) return undefined;
    throw error;
  }
}

/** A wrong default socket is the likeliest first failure, so a miss lists the sockets the image does have. */
async function socketProbe(
  transport: IncusTransport,
  instance: string,
  socket: string,
  uid: number,
): Promise<{ answered: boolean; elsewhere: string[] }> {
  const quoted = `'${socket.replace(/'/g, `'\\''`)}'`;
  try {
    const result = await incusExec(
      transport,
      instance,
      [
        "sh",
        "-c",
        `test -S ${quoted} && ss -xl 2>/dev/null | grep -qF ${quoted} && exit 0; ls /run/user/1000/*.sock 2>/dev/null; exit 1`,
      ],
      { uid, timeoutMs: 15_000 },
    );
    return {
      answered: result.code === 0,
      elsewhere: result.code === 0 ? [] : result.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    };
  } catch {
    return { answered: false, elsewhere: [] };
  }
}

export async function incusComputerStatus(
  settings: IncusSettings,
  botId: string,
  deps: IncusDeps = {},
): Promise<IncusComputerStatus> {
  const instance = incusInstanceName(botId);
  const image = settings.image ?? BASE_IMAGE;
  const empty: IncusComputerStatus = {
    configured: incusConfigured(settings),
    instance,
    image,
    state: "missing",
    desktopReady: false,
    ready: false,
    problem: null,
  };
  if (!empty.configured) return { ...empty, problem: "Configure the Incus server in Settings and try again" };
  const transport = transportFor(settings, deps);
  let found: IncusInstance | undefined;
  try {
    found = await readInstance(transport, instance);
  } catch (error) {
    return {
      ...empty,
      problem: `Incus could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!found) return { ...empty, problem: "No Incus computer exists for this bot yet" };
  const state = stateOf(found.status);
  const socket = settings.cuaSocket ?? INCUS_CUA_SOCKET;
  const uid = settings.uid ?? INCUS_DESKTOP_UID;
  const probe = state === "running"
    ? await socketProbe(transport, instance, socket, uid)
    : { answered: false, elsewhere: [] };
  return {
    ...empty,
    state,
    desktopReady: probe.answered,
    ready: state === "running" && probe.answered,
    problem:
      state === "running" && !probe.answered
        ? probe.elsewhere.length
          ? `The Cua desktop is not answering at ${socket}; this image has ${probe.elsewhere.join(", ")} — set incus.cuaSocket to the right path`
          : `The Cua desktop is not answering inside the Incus computer (${socket}); recreate it`
        : state === "error"
          ? "The Incus computer failed to start; recreate it"
          : null,
  };
}

export type IncusLifecycleAction = "provision" | "start" | "stop" | "remove";

export interface IncusLifecycleResult {
  created: boolean;
  state: IncusComputerState;
}

export async function incusComputerAction(
  settings: IncusSettings,
  botId: string,
  action: IncusLifecycleAction,
  deps: IncusDeps = {},
): Promise<IncusLifecycleResult> {
  if (!incusConfigured(settings)) throw new Error("Configure the Incus server in Settings first");
  const transport = transportFor(settings, deps);
  const name = incusInstanceName(botId);
  const path = incusInstancePath(name);

  const wait = async (response: IncusResponse, timeoutMs: number) => {
    const operation = await waitIncusOperation(transport, response, { timeoutMs });
    if (!incusOperationSucceeded(operation)) throw new Error(incusOperationError(operation));
    return operation;
  };

  if (action === "provision" || action === "start") {
    const existing = await readInstance(transport, name);
    if (!existing) {
      if (action === "start") throw new Error("No Incus computer exists for this bot yet");
      const created = await transport.request(
        "POST",
        "/1.0/instances",
        incusInstanceSpec(settings, botId, name),
      );
      await wait(created, CREATE_TIMEOUT_MS);
      return { created: true, state: "running" };
    }
    if (stateOf(existing.status) === "running") return { created: false, state: "running" };
    const started = await transport.request("PUT", `${path}/state`, { action: "start" });
    await wait(started, LIFECYCLE_TIMEOUT_MS);
    return { created: false, state: "running" };
  }

  if (action === "stop") {
    try {
      const stopped = await transport.request("PUT", `${path}/state`, { action: "stop", force: true });
      await wait(stopped, LIFECYCLE_TIMEOUT_MS);
    } catch (error) {
      if (!isIncusStatus(error, 404)) throw error;
    }
    return { created: false, state: "stopped" };
  }

  try {
    await transport.request("PUT", `${path}/state`, { action: "stop", force: true }).catch(() => {});
    const deleted = await transport.request("DELETE", path);
    await wait(deleted, LIFECYCLE_TIMEOUT_MS);
  } catch (error) {
    if (!isIncusStatus(error, 404)) throw error;
  }
  return { created: false, state: "missing" };
}

export interface IncusComputerInstance {
  name: string;
  botId: string | null;
  state: IncusComputerState;
  created: string | null;
}

export interface IncusComputerInventory {
  available: boolean;
  problem: string | null;
  instances: IncusComputerInstance[];
}

/** Lists every instance this deployment made, so leftovers of a deleted bot stay visible and removable. */
export async function incusListManagedComputers(
  settings: IncusSettings | undefined,
  deps: IncusDeps = {},
): Promise<IncusComputerInventory> {
  if (!incusConfigured(settings)) {
    return { available: false, problem: "Configure the Incus server in Settings first", instances: [] };
  }
  try {
    const { metadata } = await transportFor(settings, deps).request("GET", "/1.0/instances?recursion=1");
    const rows = Array.isArray(metadata) ? (metadata as Array<Record<string, unknown>>) : [];
    const instances = rows
      .filter((row) => typeof row.name === "string" && row.name.startsWith(`${INCUS_INSTANCE_PREFIX}-`))
      .map((row) => {
        const config = (row.config ?? {}) as Record<string, string>;
        return {
          name: String(row.name),
          botId: config[INCUS_COMPUTER_LABEL] ?? null,
          state: stateOf(typeof row.status === "string" ? row.status : undefined),
          created: typeof row.created_at === "string" ? row.created_at : null,
        };
      });
    return { available: true, problem: null, instances };
  } catch (error) {
    return {
      available: false,
      problem: `Incus could not list its computers: ${error instanceof Error ? error.message : String(error)}`,
      instances: [],
    };
  }
}

/** Removal by name, for an instance whose bot is gone; a bot's own computer is removed through its id. */
export async function incusRemoveComputer(
  settings: IncusSettings | undefined,
  name: string,
  deps: IncusDeps = {},
): Promise<void> {
  if (!incusConfigured(settings)) throw new Error("Configure the Incus server in Settings first");
  if (!name.startsWith(`${INCUS_INSTANCE_PREFIX}-`)) throw new Error("not a managed Incus computer");
  const transport = transportFor(settings, deps);
  const path = incusInstancePath(name);
  try {
    await transport.request("PUT", `${path}/state`, { action: "stop", force: true }).catch(() => {});
    const deleted = await transport.request("DELETE", path);
    const operation = await waitIncusOperation(transport, deleted, { timeoutMs: LIFECYCLE_TIMEOUT_MS });
    if (!incusOperationSucceeded(operation)) throw new Error(incusOperationError(operation));
  } catch (error) {
    if (!isIncusStatus(error, 404)) throw error;
  }
}

export async function incusComputerExec(
  settings: IncusSettings,
  botId: string,
  command: string[],
  options: IncusExecOptions & { stdin?: string | Buffer } = {},
  deps: IncusDeps = {},
) {
  if (!incusConfigured(settings)) throw new Error("Configure the Incus server in Settings first");
  const uid = settings.uid ?? INCUS_DESKTOP_UID;
  return incusExec(transportFor(settings, deps), incusInstanceName(botId), command, {
    uid,
    ...options,
  });
}

export async function incusComputerFrame(
  settings: IncusSettings,
  botId: string,
  deps: IncusDeps = {},
): Promise<{ png: string; format: "png" | "jpeg" }> {
  const transport = transportFor(settings, deps);
  const name = incusInstanceName(botId);
  const uid = settings.uid ?? INCUS_DESKTOP_UID;
  const driver = settings.cuaExecutable ?? INCUS_CUA_EXECUTABLE;
  const socket = settings.cuaSocket ?? INCUS_CUA_SOCKET;
  const shot = await incusExec(
    transport,
    name,
    [driver, "call", "get_desktop_state", "{}", "--socket", socket, "--screenshot-out-file", SCREENSHOT_PATH],
    { uid, timeoutMs: 30_000 },
  );
  if (shot.code !== 0) {
    throw Object.assign(new Error(shot.stderr.trim() || "The Incus computer did not return a screenshot"), {
      status: 502,
    });
  }
  const bytes = await incusReadFile(transport, name, SCREENSHOT_PATH, { uid });
  const checked = wholeScreenshot(bytes);
  if (!checked.ok) {
    throw Object.assign(new Error("Cua Driver returned an incomplete screenshot"), { status: 502 });
  }
  return { png: bytes.toString("base64"), format: checked.mime === "image/jpeg" ? "jpeg" : "png" };
}

export interface IncusMcpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The stream child reads these; certificates never travel in argv, which `ps` shows to everyone. */
export function incusStreamEnv(settings: IncusSettings, botId: string): Record<string, string> {
  return {
    OMB_INCUS_URL: settings.url,
    OMB_INCUS_CLIENT_CERT: settings.clientCert,
    OMB_INCUS_CLIENT_KEY: settings.clientKey,
    ...(settings.serverCert ? { OMB_INCUS_SERVER_CERT: settings.serverCert } : {}),
    OMB_INCUS_PROJECT: settings.project,
    OMB_INCUS_INSTANCE: incusInstanceName(botId),
    OMB_INCUS_UID: String(settings.uid ?? INCUS_DESKTOP_UID),
    OMB_INCUS_CUA_EXECUTABLE: settings.cuaExecutable ?? INCUS_CUA_EXECUTABLE,
    OMB_INCUS_CUA_SOCKET: settings.cuaSocket ?? INCUS_CUA_SOCKET,
  };
}

export function incusComputerMcp(
  settings: IncusSettings,
  botId: string,
  control?: { url: string; token: string },
): IncusMcpLaunch {
  return {
    command: process.execPath,
    args: [SPAWNED_PROXIES.incusContainerMcp],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      ...incusStreamEnv(settings, botId),
      ...(control ? { OMB_CONTROL_URL: control.url, OMB_CONTROL_TOKEN: control.token } : {}),
    },
  };
}
