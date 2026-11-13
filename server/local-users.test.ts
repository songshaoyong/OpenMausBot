import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalUsers, scopesForRole } from "./local-users.ts";

let dir = "";
let next = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-users-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("accounts made by hand", () => {
  it("adds an account and signs it in with its password", () => {
    const users = createLocalUsers(dir);
    const added = users.add({ email: "  Ada@Example.COM ", password: "correct-horse", role: "member" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.user.email).toBe("ada@example.com");
    expect(added.user.role).toBe("member");
    expect(users.verify("ada@example.com", "correct-horse")?.email).toBe("ada@example.com");
    expect(users.verify("ada@example.com", "wrong-horse")).toBeNull();
    expect(users.verify("nobody@example.com", "correct-horse")).toBeNull();
  });

  it("refuses a short password, a broken address and a duplicate", () => {
    const users = createLocalUsers(dir);
    expect(users.add({ email: "a@b.co", password: "short", role: "member" })).toMatchObject({ ok: false });
    expect(users.add({ email: "not-an-address", password: "long-enough", role: "member" })).toMatchObject({ ok: false });
    expect(users.add({ email: "ada@example.com", password: "another-one", role: "member" })).toMatchObject({ ok: false });
  });

  it("changes a password, so the old one stops working, and removes the account", () => {
    const users = createLocalUsers(dir);
    expect(users.setPassword("ada@example.com", "brand-new-one")).toBe(true);
    expect(users.verify("ada@example.com", "correct-horse")).toBeNull();
    expect(users.verify("ada@example.com", "brand-new-one")?.email).toBe("ada@example.com");
    expect(users.remove("ada@example.com")).toBe(true);
    expect(users.list().some((user) => user.email === "ada@example.com")).toBe(false);
    expect(users.remove("ada@example.com")).toBe(false);
  });

  it("keeps the file free of passwords", () => {
    const users = createLocalUsers(dir);
    users.add({ email: "Grace@Example.com", password: "hopper-was-here", role: "admin" });
    const raw = require("node:fs").readFileSync(join(dir, "users.json"), "utf8") as string;
    expect(raw).not.toContain("hopper-was-here");
    expect(raw).toContain("grace@example.com");
  });

  it("gives an admin every scope and a member only chat", () => {
    expect(scopesForRole("admin")).toEqual(["admin", "client"]);
    expect(scopesForRole("member")).toEqual(["client"]);
  });

  it("reads the same accounts back in a fresh registry over the same file", () => {
    const users = createLocalUsers(dir);
    users.add({ email: "alan@example.com", password: "turing-test-1", role: "member" });
    next = dir;
    const again = createLocalUsers(next);
    expect(again.list().map((user) => user.email)).toContain("alan@example.com");
    expect(again.verify("alan@example.com", "turing-test-1")?.email).toBe("alan@example.com");
  });
});
