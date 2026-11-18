import { describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";
import { localVmShare } from "./local-vm-share.ts";

const running = {
  container: "running" as const,
  viewer_url: "http://127.0.0.1:34123/vnc.html#autoconnect=true&resize=scale&password=Ab_c-12",
};

type ShareConfig = NonNullable<AppConfig["localVm"]>["share"];

const cfg = (share: ShareConfig) => ({ localVm: { share } }) as AppConfig;

describe("localVmShare", () => {
  it("stays null until the person says where the desktop is shared", () => {
    expect(localVmShare(running, {})).toBeNull();
  });

  it("carries the viewer's current password, which changes with every recreated container", () => {
    const share = localVmShare(running, cfg({ baseUrl: "http://192.168.66.247", viewerPort: 6902, servicePort: 8765 }));

    expect(share).toEqual({
      viewer: "http://192.168.66.247:6902/vnc.html#autoconnect=true&resize=scale&password=Ab_c-12",
      services: "http://192.168.66.247:8765/",
    });
  });

  it("offers no viewer while the desktop is stopped", () => {
    const share = localVmShare({ ...running, container: "stopped" }, cfg({ baseUrl: "http://192.168.66.247", viewerPort: 6902 }));

    expect(share?.viewer).toBeNull();
    expect(share?.services).toBeNull();
  });

  it("takes the ports from the configuration, not from the runtime's own random ones", () => {
    const share = localVmShare(running, cfg({ baseUrl: "https://bots.example.com/", viewerPort: 443 }));

    expect(share?.viewer?.startsWith("https://bots.example.com:443/vnc.html#")).toBe(true);
    expect(share?.services).toBeNull();
  });
});
