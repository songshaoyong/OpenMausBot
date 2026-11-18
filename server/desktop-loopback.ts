// A browser connection to desktop.localhost enters that bot's private desktop. localhost stays this computer.
import { spawn, type ChildProcess } from "node:child_process";
import { Duplex } from "node:stream";

import { augmentedPath, resolveCliSpawn } from "./env-path.ts";

/** Fixed program. The port arrives only as an integer environment value, never as part of a shell command. */
export const DESKTOP_BRIDGE =
  "import os,select,socket,sys\n" +
  "port=int(os.environ['OMB_DESKTOP_PORT'])\n" +
  "sock=socket.create_connection(('127.0.0.1',port),10)\n" +
  "sock.setblocking(False)\n" +
  "inp,out=sys.stdin.fileno(),sys.stdout.fileno()\n" +
  "os.set_blocking(inp,False)\n" +
  "while True:\n" +
  " r,_,_=select.select([sock,inp],[],[],60)\n" +
  " if sock in r:\n" +
  "  data=sock.recv(65536)\n" +
  "  if not data: break\n" +
  "  os.write(out,data)\n" +
  " if inp in r:\n" +
  "  data=os.read(inp,65536)\n" +
  "  if not data: break\n" +
  "  sock.sendall(data)\n";

export function privateDesktopExecArgs(_runtime: "docker" | "podman", containerName: string, port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("not a desktop port");
  if (!/^[\w.-]+$/.test(containerName)) throw new Error("not a desktop container");
  return ["exec", "-i", "-e", `OMB_DESKTOP_PORT=${port}`, "-u", "cua", containerName, "/opt/venv/bin/python", "-c", DESKTOP_BRIDGE];
}

/** The container's python copies bytes between this process and 127.0.0.1:port inside the desktop. */
export function openPrivateDesktopPort(runtime: "docker" | "podman", containerName: string, port: number): Duplex {
  const args = privateDesktopExecArgs(runtime, containerName, port);
  const resolved = resolveCliSpawn(runtime, args);
  const child = spawn(resolved.command, resolved.args, {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    env: { ...process.env, PATH: augmentedPath() },
  });
  return childDuplex(child);
}

function childDuplex(child: ChildProcess): Duplex {
  const input = child.stdin;
  const output = child.stdout;
  if (!input || !output) {
    child.kill();
    throw new Error("the desktop bridge has no pipes");
  }
  const duplex = new Duplex({
    read() { output.resume(); },
    write(chunk, encoding, callback) { input.write(chunk, encoding, callback); },
    final(callback) { input.end(); callback(); },
    destroy(error, callback) { child.kill(); callback(error); },
  });
  output.on("data", (chunk: Buffer) => { if (!duplex.push(chunk)) output.pause(); });
  output.on("end", () => duplex.push(null));
  child.on("error", (error) => duplex.destroy(error));
  return duplex;
}
