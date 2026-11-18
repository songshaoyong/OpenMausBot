import { describe, expect, it } from "vitest";

import { privateDesktopExecArgs } from "./desktop-loopback.ts";

describe("private desktop loopback", () => {
  it("execs a fixed python bridge and puts only the port in the environment", () => {
    const args = privateDesktopExecArgs("podman", "openmausbot-computer-abcdef0123456789", 8000);
    expect(args.slice(0, 6)).toEqual(["exec", "-i", "-e", "OMB_DESKTOP_PORT=8000", "-u", "cua"]);
    expect(args[6]).toBe("openmausbot-computer-abcdef0123456789");
    expect(args[7]).toBe("/opt/venv/bin/python");
    expect(args.join(" ")).not.toContain("sh -c");
    expect(() => privateDesktopExecArgs("docker", "name;id", 8000)).toThrow(/container/);
    expect(() => privateDesktopExecArgs("docker", "openmausbot-computer", 0)).toThrow(/port/);
  });
});
