import { describe, expect, it } from "vitest";

import { DESKTOP_VIEWER_TARGET, viewerTargetId } from "./desktop-viewer.ts";

const digest = "a".repeat(64);

describe("the desktop viewer's names", () => {
  it.each([
    "local/shared",
    `local/bot-${digest}`,
    `local/shared-desktop-${digest}`,
    "local/pool-3",
    "vps/bot-1",
  ])("serves %s", (target) => {
    expect(DESKTOP_VIEWER_TARGET.test(target)).toBe(true);
  });

  it.each([
    "local/shared-desktop",
    `local/shared-desktop-${"A".repeat(64)}`,
    `local/shared-desktop-${digest.slice(1)}`,
    "local/shared-desktop-../x",
    "local/bot-ada",
    "vps/",
  ])("refuses %s", (target) => {
    expect(DESKTOP_VIEWER_TARGET.test(target)).toBe(false);
  });

  it("names a named shared desktop by its digest, as every Local VM is named", () => {
    expect(viewerTargetId({ key: `shared-desktop:${digest}` })).toBe(`local/shared-desktop-${digest}`);
  });
});
