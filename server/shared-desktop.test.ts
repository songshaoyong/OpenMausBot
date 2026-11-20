import { describe, expect, it } from "vitest";

import { parseConfigPatch, parseStoredConfig } from "./config.ts";
import { sharedDesktopLocalVmTarget } from "./container-computer.ts";

describe("shared desktop containers", () => {
  it("maps a desktop id to one durable container and workspace", () => {
    const first = sharedDesktopLocalVmTarget("shared-desktop-project-a");
    const again = sharedDesktopLocalVmTarget("shared-desktop-project-a");
    expect(again).toEqual(first);
    expect(first.key.startsWith("shared-desktop:")).toBe(true);
    expect(first.workspaceDir).toBe(again.workspaceDir);
    expect(first.containerName).toBe(again.containerName);
  });

  it("keeps different desktops apart", () => {
    const a = sharedDesktopLocalVmTarget("shared-desktop-project-a");
    const b = sharedDesktopLocalVmTarget("shared-desktop-project-b");
    expect(a.key).not.toBe(b.key);
    expect(a.containerName).not.toBe(b.containerName);
    expect(a.workspaceDir).not.toBe(b.workspaceDir);
  });

  it("loads and patches the shared desktop registry", () => {
    expect(parseStoredConfig({
      localVmSharedDesktops: [{ id: "shared-desktop-project-a", name: "Project A" }],
    }).localVmSharedDesktops).toEqual([{ id: "shared-desktop-project-a", name: "Project A" }]);
    expect(parseConfigPatch({
      localVmSharedDesktops: [{ id: "shared-desktop-project-a", name: "Project A" }],
    }).localVmSharedDesktops).toEqual([{ id: "shared-desktop-project-a", name: "Project A" }]);
  });

  it("refuses duplicate and unsafe shared desktop ids", () => {
    expect(() => parseConfigPatch({
      localVmSharedDesktops: [
        { id: "shared-desktop-project-a", name: "Project A" },
        { id: "shared-desktop-project-a", name: "Project A again" },
      ],
    })).toThrow();
    expect(() => parseConfigPatch({
      localVmSharedDesktops: [{ id: "Shared Desktop Project A", name: "Project A" }],
    })).toThrow();
  });
});
