// Incus's REST API over a client certificate: the only transport a container-hosted server can use,
// since the image ships no incus CLI and mounts no daemon socket.
import { X509Certificate } from "node:crypto";
import { Agent as HttpsAgent } from "node:https";
import type { ConnectionOptions } from "node:tls";
import { Agent, request as undiciRequest } from "undici";
import WebSocket from "ws";

export const INCUS_OPERATION_WAIT_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 30_000;
const STREAM_CAP_BYTES = 8 * 1024 * 1024;
const TERMINATE_GRACE_MS = 2_000;

export type IncusMethod = "GET" | "POST" | "PUT" | "DELETE";

/** The envelope every Incus endpoint answers with; `operation` names the task a mutating call started. */
export interface IncusResponse {
  metadata: unknown;
  operation?: string;
}

export interface IncusOperation {
  id?: string;
  status?: string;
  status_code?: number;
  err?: string;
  metadata?: { return?: number; fds?: Record<string, string> } | null;
}

export interface IncusSocketHandlers {
  message(data: Buffer, binary: boolean): void;
  close(): void;
  error(error: unknown): void;
}

export interface IncusSocket {
  send(data: string | Buffer): Promise<void>;
  close(): void;
}

/** One HTTPS connection pool plus its websocket factory, sharing one client certificate. */
export interface IncusTransport {
  request(method: IncusMethod, path: string, body?: unknown, signal?: AbortSignal): Promise<IncusResponse>;
  socket(path: string, handlers: IncusSocketHandlers): Promise<IncusSocket>;
}

export interface IncusConnection {
  url: string;
  clientCert: string;
  clientKey: string;
  serverCert?: string;
  project: string;
}

export class IncusError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "IncusError";
    this.status = status;
  }
}

export function isIncusStatus(error: unknown, status: number): boolean {
  return error instanceof IncusError && error.status === status;
}

/** A self-signed Incus certificate rarely carries the address clients dial, so a configured one is pinned exactly. */
export function incusTlsOptions(
  connection: Pick<IncusConnection, "clientCert" | "clientKey" | "serverCert">,
): ConnectionOptions {
  const serverCert = connection.serverCert?.trim();
  if (!serverCert) return { cert: connection.clientCert, key: connection.clientKey };
  const pinned = new X509Certificate(serverCert).raw;
  return {
    cert: connection.clientCert,
    key: connection.clientKey,
    ca: serverCert,
    checkServerIdentity: (_host, peer) =>
      peer.raw?.equals(pinned)
        ? undefined
        : new Error("the Incus server presented a different certificate than the configured one"),
  };
}

/** Every path carries the project: one connection serves a server on which other projects exist. */
export function withIncusProject(path: string, project: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;
}

class IncusHttpTransport implements IncusTransport {
  private readonly base: URL;
  private readonly tls: ConnectionOptions;
  private readonly project: string;
  private pool: Agent | undefined;
  private sockets: HttpsAgent | undefined;

  constructor(connection: IncusConnection) {
    this.base = new URL(connection.url);
    if (this.base.protocol !== "https:") throw new Error("the Incus API address must use https");
    this.tls = incusTlsOptions(connection);
    this.project = connection.project;
  }

  async request(
    method: IncusMethod,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<IncusResponse> {
    this.pool ??= new Agent({ connect: this.tls });
    const response = await undiciRequest(new URL(withIncusProject(path, this.project), this.base), {
      method,
      dispatcher: this.pool,
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk as Uint8Array));
    const text = Buffer.concat(chunks).toString("utf8");
    let parsed: { type?: string; error?: string; error_code?: number; metadata?: unknown; operation?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new IncusError(`Incus returned HTTP ${response.statusCode}`, response.statusCode);
    }
    if (parsed.type === "error" || response.statusCode >= 400) {
      throw new IncusError(
        parsed.error || `Incus returned HTTP ${response.statusCode}`,
        parsed.error_code || response.statusCode,
      );
    }
    return { metadata: parsed.metadata, operation: parsed.operation || undefined };
  }

  socket(path: string, handlers: IncusSocketHandlers): Promise<IncusSocket> {
    const url = new URL(withIncusProject(path, this.project), this.base);
    url.protocol = "wss:";
    return new Promise((resolve, reject) => {
      this.sockets ??= new HttpsAgent(this.tls);
      const socket = new WebSocket(url, { agent: this.sockets, handshakeTimeout: REQUEST_TIMEOUT_MS });
      let open = false;
      socket.on("message", (data, binary) => handlers.message(Buffer.from(data as Buffer), binary));
      socket.on("close", () => handlers.close());
      socket.on("error", (error) => (open ? handlers.error(error) : reject(error)));
      socket.once("open", () => {
        open = true;
        resolve({
          send: (data) =>
            new Promise((sent, failed) =>
              socket.send(data, (error) => (error ? failed(error) : sent())),
            ),
          close: () => {
            if (socket.readyState === WebSocket.OPEN) socket.close(1000);
            else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
          },
        });
      });
    });
  }
}

export function createIncusTransport(connection: IncusConnection): IncusTransport {
  return new IncusHttpTransport(connection);
}

export function incusOperationPath(response: IncusResponse): string {
  const path = response.operation;
  if (!path || !/^\/1\.0\/operations\/[A-Za-z0-9-]+$/.test(path)) {
    throw new Error("Incus did not return an operation");
  }
  return path;
}

/** A mutating call answers before the work is done; the operation carries the outcome. */
export async function waitIncusOperation(
  transport: IncusTransport,
  response: IncusResponse,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<IncusOperation> {
  const path = incusOperationPath(response);
  const deadline = Date.now() + (options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  for (;;) {
    const { metadata } = await transport.request(
      "GET",
      `${path}/wait?timeout=${INCUS_OPERATION_WAIT_SECONDS}`,
      undefined,
      options.signal,
    );
    const operation = (metadata ?? {}) as IncusOperation;
    if ((operation.status_code ?? 0) >= 200) return operation;
    if (Date.now() >= deadline) throw new Error(`Incus operation ${path} did not finish in time`);
  }
}

export function incusOperationSucceeded(operation: IncusOperation): boolean {
  return operation.status_code === 200;
}

export function incusOperationError(operation: IncusOperation): string {
  return operation.err || `Incus operation ended with ${operation.status ?? "no status"}`;
}

export interface IncusExecOptions {
  /** Incus takes numeric ids here, not names: there is no passwd lookup across the exec boundary. */
  uid?: number;
  cwd?: string;
  timeoutMs?: number;
  stdout?: (data: Buffer) => void;
  stderr?: (data: Buffer) => void;
}

export interface IncusExecSession {
  write(data: string | Buffer): Promise<void>;
  endInput(): Promise<void>;
  close(): void;
  done: Promise<{ code: number; timedOut: boolean }>;
}

export function incusInstancePath(name: string): string {
  return `/1.0/instances/${encodeURIComponent(name)}`;
}

export function incusExecExitCode(operation: IncusOperation, timedOut: boolean): number {
  if (timedOut) return 124;
  const code = operation.metadata?.return;
  if (Number.isSafeInteger(code) && code! >= 0 && code! <= 255) return code!;
  return incusOperationSucceeded(operation) ? 0 : 1;
}

interface IncusStream {
  socket: Promise<IncusSocket>;
  ended: Promise<void>;
}

/**
 * An exec is one websocket per file descriptor, handed out as secrets on the operation: the command
 * starts only once they connect. `control` carries signals, which is how a stuck command is stopped.
 */
export async function openIncusExec(
  transport: IncusTransport,
  instance: string,
  command: string[],
  options: IncusExecOptions = {},
): Promise<IncusExecSession> {
  const started = await transport.request("POST", `${incusInstancePath(instance)}/exec`, {
    command,
    "wait-for-websocket": true,
    interactive: false,
    ...(options.uid !== undefined ? { user: options.uid, group: options.uid } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
  const fds = (started.metadata as IncusOperation | undefined)?.metadata?.fds ?? {};
  const operation = incusOperationPath(started);
  const opened: Promise<IncusSocket>[] = [];

  const stream = (fd: string, onMessage?: (data: Buffer) => void): IncusStream => {
    const secret = fds[fd];
    if (!secret) throw new Error(`Incus exec did not offer stream ${fd}`);
    let end!: () => void;
    const ended = new Promise<void>((resolve) => (end = resolve));
    const socket = transport.socket(`${operation}/websocket?secret=${encodeURIComponent(secret)}`, {
      message: (data) => onMessage?.(data),
      close: end,
      error: end,
    });
    opened.push(socket);
    return { socket, ended };
  };

  const streams = {
    input: stream("0"),
    out: stream("1", (data) => options.stdout?.(data)),
    err: stream("2", (data) => options.stderr?.(data)),
    control: stream("control"),
  };
  for (const entry of Object.values(streams)) void entry.socket.catch(() => {});

  let timedOut = false;
  const terminate = async () => {
    await streams.control.socket
      .then((socket) => socket.send(JSON.stringify({ command: "signal", signal: 15 })))
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, TERMINATE_GRACE_MS).unref());
    const live = await Promise.allSettled(opened).then((results) =>
      results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
    );
    for (const socket of live) socket.close();
  };

  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        void terminate();
      }, options.timeoutMs)
    : null;
  timer?.unref?.();

  const done = (async () => {
    try {
      await Promise.all([streams.out.ended, streams.err.ended]);
      const finished = await waitIncusOperation(transport, started, {
        timeoutMs: options.timeoutMs === undefined ? undefined : options.timeoutMs + 10_000,
      });
      return { code: incusExecExitCode(finished, timedOut), timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return {
    write: async (data) => {
      const socket = await streams.input.socket;
      await socket.send(Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    endInput: async () => {
      (await streams.input.socket).close();
    },
    close: () => {
      void terminate();
    },
    done,
  };
}

export interface IncusExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function incusExec(
  transport: IncusTransport,
  instance: string,
  command: string[],
  options: IncusExecOptions & { stdin?: string | Buffer } = {},
): Promise<IncusExecResult> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let kept = 0;
  const keep = (buf: Buffer, into: Buffer[]) => {
    if (kept + buf.byteLength > STREAM_CAP_BYTES) return;
    kept += buf.byteLength;
    into.push(buf);
  };
  const session = await openIncusExec(transport, instance, command, {
    ...options,
    stdout: (data) => keep(data, stdout),
    stderr: (data) => keep(data, stderr),
  });
  try {
    if (options.stdin !== undefined) await session.write(options.stdin);
    await session.endInput();
    const { code, timedOut } = await session.done;
    return {
      code,
      timedOut,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
  } finally {
    session.close();
  }
}

/** The files endpoint answers raw bytes outside the JSON envelope, so file access rides base64 over exec. */
export async function incusReadFile(
  transport: IncusTransport,
  instance: string,
  path: string,
  options: IncusExecOptions = {},
): Promise<Buffer> {
  const result = await incusExec(transport, instance, ["base64", "-w0", path], {
    ...options,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `could not read ${path} from the Incus computer`);
  }
  return Buffer.from(result.stdout.trim(), "base64");
}

export async function incusWriteFile(
  transport: IncusTransport,
  instance: string,
  path: string,
  data: Buffer | string,
  options: IncusExecOptions = {},
): Promise<void> {
  const encoded = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result = await incusExec(transport, instance, ["sh", "-c", `base64 -d > ${JSON.stringify(path)}`], {
    ...options,
    stdin: encoded.toString("base64"),
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `could not write ${path} on the Incus computer`);
  }
}
