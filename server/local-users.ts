// Accounts the server's owner creates by hand: an address, a password and a role. This exists because the other
// ways in need something a home server usually has none of — a mail service for an emailed code, or a second
// device for a pairing code. Passwords are held as scrypt hashes with a per-user salt and never read back.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import type { Scope } from "./sessions.ts";

export type LocalRole = "admin" | "member";

export interface LocalUser {
  id: string;
  email: string;
  role: LocalRole;
  createdAt: number;
  lastSeenAt: number | null;
}

export type LocalUserResult =
  | { ok: true; user: LocalUser }
  | { ok: false; error: string };

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
const KEY_BYTES = 64;

const recordSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(3).max(320),
  role: z.enum(["admin", "member"]),
  salt: z.string().min(1),
  hash: z.string().min(1),
  createdAt: z.number(),
  lastSeenAt: z.number().nullable(),
});
const fileSchema = z.object({ version: z.literal(1), users: z.array(recordSchema) });
type Record_ = z.infer<typeof recordSchema>;

/** What each role may do: an admin owns the server, a member only chats and answers approvals. */
export function scopesForRole(role: LocalRole): Scope[] {
  return role === "admin" ? ["admin", "client"] : ["client"];
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_BYTES).toString("base64");
}

function samePassword(password: string, salt: string, hash: string): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(hash, "base64");
  } catch {
    return false;
  }
  if (expected.length !== KEY_BYTES) return false;
  const actual = scryptSync(password, salt, KEY_BYTES);
  return timingSafeEqual(actual, expected);
}

export function createLocalUsers(dataDir: string) {
  const file = join(dataDir, "users.json");

  const read = (): Record_[] => {
    if (!existsSync(file)) return [];
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? parsed.data.users : [];
    } catch {
      return [];
    }
  };

  /** Atomic write, owner-only: a half-written file must not become the account list. */
  const write = (users: Record_[]) => {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, users }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  };

  const view = (record: Record_): LocalUser => ({
    id: record.id,
    email: record.email,
    role: record.role,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
  });

  const list = (): LocalUser[] => read().map(view);

  const find = (email: string): Record_ | undefined => read().find((entry) => entry.email === email);

  const add = (input: { email: string; password: string; role: LocalRole }): LocalUserResult => {
    const email = normalizeEmail(input.email);
    if (!EMAIL_SHAPE.test(email)) return { ok: false, error: "enter a full email address, like name@company.com" };
    if (input.password.length < PASSWORD_MIN) return { ok: false, error: `the password needs at least ${PASSWORD_MIN} characters` };
    if (input.password.length > PASSWORD_MAX) return { ok: false, error: "that password is too long" };
    if (input.role !== "admin" && input.role !== "member") return { ok: false, error: "the role must be admin or member" };
    const users = read();
    if (users.some((entry) => entry.email === email)) return { ok: false, error: "that address already has an account" };
    const record: Record_ = {
      id: randomBytes(9).toString("base64url"),
      email,
      role: input.role,
      salt: randomBytes(16).toString("base64url"),
      hash: "",
      createdAt: Date.now(),
      lastSeenAt: null,
    };
    record.hash = hashPassword(input.password, record.salt);
    write([...users, record]);
    return { ok: true, user: view(record) };
  };

  const remove = (email: string): boolean => {
    const users = read();
    const next = users.filter((entry) => entry.email !== normalizeEmail(email));
    if (next.length === users.length) return false;
    write(next);
    return true;
  };

  const setPassword = (email: string, password: string): boolean => {
    const address = normalizeEmail(email);
    const users = read();
    const index = users.findIndex((entry) => entry.email === address);
    if (index < 0) return false;
    const user = users[index]!;
    user.salt = randomBytes(16).toString("base64url");
    user.hash = hashPassword(password, user.salt);
    write(users);
    return true;
  };

  /** The account a correct email and password names, or null. A wrong password costs the same time as a right one. */
  const verify = (email: string, password: string): LocalUser | null => {
    const address = normalizeEmail(email);
    const record = find(address);
    if (!record) {
      // Spend the same work as a real check, so a missing address is not faster to find than a wrong password.
      scryptSync(password, "missing-account-salt", KEY_BYTES);
      return null;
    }
    if (!samePassword(password, record.salt, record.hash)) return null;
    const users = read();
    const live = users.find((entry) => entry.email === address);
    if (live) {
      live.lastSeenAt = Date.now();
      write(users);
    }
    return view(record);
  };

  return { list, find: (email: string) => { const record = find(email); return record ? view(record) : null; }, add, remove, setPassword, verify };
}

export type LocalUsers = ReturnType<typeof createLocalUsers>;
