// Security: the invite link is convenience, not a second door; the one-time code still goes to the address itself.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, LogOut, Plus, RefreshCw, Users, X } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCopyFeedback } from "@/lib/copy-text";
import { formatUsd, hasFiniteCost } from "@/lib/usage";
import { readMembership, type Membership } from "../lib/membership";
import { readSessionState, type SessionState } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { withEntry, withoutEntry, type SignInLists } from "./SignInAccessCard";
import { Card } from "./SettingsPrimitives";
import { Select } from "./Select";

export type Role = "admin" | "member";


export interface Person {
  entry: string;
  role: Role;
  isDomain: boolean;
  lastSeenAt: number | null;
  devices: number;
  turns: number;
  costUsd: number | null;
  estimated?: boolean;
}

export function inviteLink(base: string, entry: string): string {
  const origin = base.replace(/\/+$/, "");
  return entry.startsWith("@") ? `${origin}/pair` : `${origin}/pair?email=${encodeURIComponent(entry)}`;
}

export function mergePeople(
  lists: SignInLists,
  sessions: Array<{ email?: string; lastSeenAt: number }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null; estimatedUsd?: number | null }>,
): Person[] {
  const people: Person[] = [];
  const seen = new Set<string>();
  const add = (entry: string, role: Role) => {
    const key = entry.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const devices = sessions.filter((session) => session.email?.toLowerCase() === key);
    const month = usage.find((group) => group.key === `user:${key}`);
    people.push({
      entry: key,
      role,
      isDomain: key.startsWith("@"),
      lastSeenAt: devices.length ? Math.max(...devices.map((session) => session.lastSeenAt)) : null,
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
      ...(hasFiniteCost(month?.estimatedUsd) && month.estimatedUsd > 0 ? { estimated: true } : {}),
    });
  };
  for (const entry of lists.admins) add(entry, "admin");
  for (const entry of lists.members) add(entry, "member");
  return people;
}

export function peopleFromSessions(
  sessions: Array<{ email?: string; lastSeenAt: number; scopes?: string[] }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null }>,
): Person[] {
  const byEmail = new Map<string, Array<{ lastSeenAt: number; scopes?: string[] }>>();
  for (const session of sessions) {
    const email = session.email?.trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), session]);
  }
  return [...byEmail.entries()].map(([entry, devices]) => {
    const month = usage.find((group) => group.key === `user:${entry}`);
    return {
      entry,
      role: devices.some((device) => device.scopes?.includes("admin")) ? "admin" : "member",
      isDomain: false,
      lastSeenAt: Math.max(...devices.map((device) => device.lastSeenAt)),
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
    } satisfies Person;
  }).sort((a, b) => (a.role === b.role ? a.entry.localeCompare(b.entry) : a.role === "admin" ? -1 : 1));
}

export function lastSeenLabel(lastSeenAt: number | null, now = Date.now()): string {
  if (lastSeenAt === null) return t("people.never");
  if (now - lastSeenAt < 24 * 60 * 60_000) return t("people.today");
  return new Date(lastSeenAt).toISOString().slice(0, 10);
}

export function PeopleTable({ people, busy, onRole, onRemove, onLink, readOnly = false }: {
  people: Person[];
  busy: boolean;
  onRole: (person: Person, role: Role) => void;
  onRemove: (person: Person) => void;
  onLink: (person: Person) => void;
  readOnly?: boolean;
}) {
  if (people.length === 0) return <p className="text-[13px] text-ink-secondary">{t(readOnly ? "people.portal.empty" : "people.empty")}</p>;
  const columns = "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4";
  return (
    <div className="flex flex-col">
      <div className={cn(columns, "border-b border-hairline/40 pb-2 text-[12px] font-medium uppercase tracking-wide text-ink-secondary")}>
        <span>{t("people.colPerson")}</span>
        <span>{t("people.colRole")}</span>
        <span className="text-right">{t("people.colLastSeen")}</span>
        <span className="text-right">{t("people.colMonth")}</span>
        <span />
      </div>
      {people.map((person) => (
        <div key={person.entry} className={cn(columns, "border-b border-hairline/20 py-2 text-[13px]")}>
          <span className="min-w-0">
            <span className="block truncate text-ink">{person.isDomain ? t("people.everyoneAt", { domain: person.entry.slice(1) }) : person.entry}</span>
            {person.devices > 0 && <span className="block text-[12px] text-ink-secondary">{t("people.devices", { count: String(person.devices) })}</span>}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", person.role === "admin" ? "bg-accent/15 text-accent" : "bg-control text-ink-secondary")}>
            {person.role === "admin" ? t("people.roleAdmin") : t("people.roleMember")}
          </span>
          <span className="text-right tabular-nums text-ink-secondary">{person.isDomain ? "—" : lastSeenLabel(person.lastSeenAt)}</span>
          <span className="text-right tabular-nums text-ink" title={t("people.turns", { turns: String(person.turns) })}>
            {hasFiniteCost(person.costUsd) ? `${person.estimated ? "~" : ""}${formatUsd(person.costUsd)}` : "—"}
          </span>
          {readOnly ? <span /> : <span className="flex items-center justify-end gap-2 text-[12px]">
            <button type="button" disabled={busy} onClick={() => onLink(person)} aria-label={t("people.link")} title={t("people.link")} className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"><Link2 size={13} /></button>
            <button type="button" disabled={busy} onClick={() => onRole(person, person.role === "admin" ? "member" : "admin")} className="text-ink-secondary hover:text-ink disabled:opacity-50">
              {person.role === "admin" ? t("people.makeMember") : t("people.makeAdmin")}
            </button>
            <button type="button" disabled={busy} onClick={() => onRemove(person)} className="text-danger hover:underline disabled:opacity-50">{t("people.remove")}</button>
          </span>}
        </div>
      ))}
    </div>
  );
}

export interface LocalUserRow {
  email: string;
  role: string;
  createdAt: number;
  lastSeenAt: number | null;
}

/** The accounts this server holds: who signs in with a password, and when they were last here. */
export function LocalUsersTable({ users, busy, onReset, onRemove }: {
  users: LocalUserRow[];
  busy: boolean;
  onReset: (email: string) => void;
  onRemove: (email: string) => void;
}) {
  if (users.length === 0) return <p className="text-[13px] text-ink-secondary">{t("people.usersEmpty")}</p>;
  const columns = "grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4";
  const seen = (at: number | null) => (at ? new Date(at).toLocaleString() : t("people.userNever"));
  return (
    <div className="flex flex-col">
      <div className={cn(columns, "border-b border-hairline/40 pb-2 text-[12px] font-medium uppercase tracking-wide text-ink-secondary")}>
        <span>{t("people.colPerson")}</span>
        <span>{t("people.colRole")}</span>
        <span className="text-right">{t("people.colLastSeen")}</span>
        <span />
      </div>
      {users.map((user) => (
        <div key={user.email} className={cn(columns, "border-b border-hairline/20 py-2 text-[13px]")}>
          <span className="min-w-0 truncate text-ink" title={user.email}>{user.email}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", user.role === "admin" ? "bg-accent/15 text-accent" : "bg-control text-ink-secondary")}>
            {user.role === "admin" ? t("people.roleAdmin") : t("people.roleMember")}
          </span>
          <span className="text-right tabular-nums text-ink-secondary">{seen(user.lastSeenAt)}</span>
          <span className="flex items-center justify-end gap-2 text-[12px]">
            <button type="button" disabled={busy} onClick={() => onReset(user.email)} className="text-ink-secondary hover:text-ink disabled:opacity-50">{t("people.userReset")}</button>
            <button type="button" disabled={busy} onClick={() => onRemove(user.email)} className="text-danger hover:underline disabled:opacity-50">{t("people.remove")}</button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The sign-out row, on the account card where people look for it. A browser on this machine is the owner by
 * being here, so there is no session to end and the row stays away. */
export function SignOutRow() {
  const [state, setState] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readSessionState().then(setState);
  }, []);

  if (!state || state.kind !== "session") return null;
  const signOut = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
    }
    window.location.reload();
  };

  return (
    <button type="button" onClick={() => void signOut()} disabled={busy} className="ui-button w-full justify-between">
      <span className="flex items-center gap-2"><LogOut size={15} aria-hidden="true" />{t("people.signOut")}</span>
      <span className="text-[12px] text-ink-secondary">{state.email ?? ""}</span>
    </button>
  );
}

export function CopyLink({ link }: { link: string }) {
  const { state, copy } = useCopyFeedback(link);
  return (
    <div className="mt-3 rounded-lg border border-hairline/40 bg-inset p-3 text-[13px]">
      <div className="mb-1 text-ink-secondary">{t("people.link")}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all text-ink">{link}</code>
        <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
          {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
          {t(state === "copied" ? "people.copied" : state === "failed" ? "common.copyFailed" : "people.copy")}
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("people.linkHint")}</p>
    </div>
  );
}

export function PortalPeople({ peopleUrl, people }: { peopleUrl: string | null; people: Person[] }) {
  const noop = () => {};
  return (
    <Card title={t("people.title")} subtitle={t("people.portal.subtitle")}>
      <div data-people-portal className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-secondary">
        <p>{t("people.portal.managed")}</p>
        {peopleUrl && (
          <a
            href={peopleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-fit items-center gap-2 rounded-lg bg-control px-3 py-2 font-medium text-ink hover:bg-control/70"
          >
            {t("people.portal.open")} <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="mt-4">
        <PeopleTable people={people} busy={false} readOnly onRole={noop} onRemove={noop} onLink={noop} />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("people.portal.note")}</p>
    </Card>
  );
}

export function PeopleSection({ simple = false, startOpen = false }: { simple?: boolean; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [tried, setTried] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [lists, setLists] = useState<SignInLists | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [emailOffered, setEmailOffered] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [notice, setNotice] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ email: string; role: string; createdAt: number; lastSeenAt: number | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, sessions, usage, environment, made] = await Promise.all([
        api("/api/config"),
        api("/api/auth/sessions").catch(() => ({ sessions: [] })),
        api("/api/usage?groupBy=user").catch(() => ({ groups: [] })),
        fetch("/.well-known/openmausbot/environment").then((res) => (res.ok ? res.json() : null)).catch(() => null),
        api<{ users?: Array<{ email: string; role: string; createdAt: number; lastSeenAt: number | null }> }>("/api/users").catch(() => ({ users: [] })),
      ]);
      const current: SignInLists = {
        admins: Array.isArray(config?.signIn?.admins) ? config.signIn.admins : [],
        members: Array.isArray(config?.signIn?.members) ? config.signIn.members : [],
      };
      const authority = readMembership(config);
      setMembership(authority);
      setLists(current);
      const signedIn = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
      const spent = Array.isArray(usage?.groups) ? usage.groups : [];
      setPeople(authority.authority === "portal" ? peopleFromSessions(signedIn, spent) : mergePeople(current, signedIn, spent));
      setUsers(Array.isArray(made?.users) ? made.users : []);
      setEmailOffered(environment?.capabilities?.emailSignIn === true ? true : environment ? false : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void readSessionState().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  const save = async (next: SignInLists) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: next }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** An account the person signs in to with a password: no mail service, no link, no second device. */
  const addUser = async () => {
    setTried(true);
    if (busy) return;
    const email = draft.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError(t("people.userEmailInvalid"));
      return;
    }
    if (password.length < 8) {
      setError(t("people.userPasswordShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const added = await api<{ user?: { email: string; role: string } }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      setDraft("");
      setPassword("");
      setNotice(added?.user ? t("people.userAdded", { email: added.user.email }) : null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (email: string) => {
    const next = window.prompt(t("people.userResetPrompt", { email }));
    if (!next) return;
    if (next.length < 8) {
      setError(t("people.userPasswordShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/users/${encodeURIComponent(email)}/password`, { method: "POST", body: JSON.stringify({ password: next }) });
      setNotice(t("people.userReset", { email }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (email: string) => {
    if (!window.confirm(t("people.userRemoveConfirm", { email }))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE", body: "{}" });
      setNotice(t("people.userRemoved", { email }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  if (!canPairDevices(session)) return null;
  const portal = membership?.authority === "portal" ? <PortalPeople peopleUrl={membership.peopleUrl} people={people} /> : null;
  const content = (
    <>
      {emailOffered === false && (!simple || tried) && <p className="mb-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[13px] text-ink-secondary">{t(membership?.pairingCodes === false ? "people.portalSignIn" : "people.notHosted")}</p>}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void addUser(); }}>
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("people.userEmail")}
          aria-label={t("people.userEmail")}
          disabled={busy}
          className="min-w-[16rem] flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("people.userPassword")}
          aria-label={t("people.userPassword")}
          disabled={busy}
          className="min-w-[10rem] flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50"
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={t("people.colRole")} disabled={busy}>
          <option value="member">{t("people.roleMember")}</option>
          <option value="admin">{t("people.roleAdmin")}</option>
        </Select>
        <button type="submit" disabled={busy || !draft.trim() || !password} className="ui-button ui-button-primary">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}{t("people.addUser")}
        </button>
        <button type="button" onClick={() => void load()} disabled={loading || busy} aria-label={t("people.refresh")} title={t("people.refresh")} className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"><RefreshCw size={13} className={cn(loading && "animate-spin")} /></button>
      </form>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("people.userHint")}</p>
      {notice && <p role="status" className="mt-2 text-[12px] text-ink-secondary">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-4">
        <LocalUsersTable users={users} busy={busy} onReset={resetPassword} onRemove={removeUser} />
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-hairline/30 pt-3">
        <span className="text-[12px] leading-relaxed text-ink-secondary">{t("people.signOutHint")}</span>
        <button type="button" onClick={() => void signOut()} disabled={busy} className="ui-button shrink-0">
          <LogOut size={13} aria-hidden="true" />{t("people.signOut")}
        </button>
      </div>
      <div className="mt-4">
        <PeopleTable
          people={people}
          busy={busy}
          onRole={(person, next) => { if (lists) void save(withEntry(lists, person.entry, next)); }}
          onRemove={(person) => { if (lists) void save(withoutEntry(lists, person.entry)); }}
          onLink={() => setNotice(t("people.linkNotNeeded"))}
        />
      </div>
      {!simple && <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("people.note")}</p>}
    </>
  );
  if (simple) {
    return (
      <div data-people-summary="">
        {/* Drawn like the name row above it, a round mark then two lines, so the Account card has one text edge. */}
        <div role="group" aria-label={t("people.title")} className="flex min-w-0 items-center gap-3 px-4 py-[13px]">
          <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary"><Users size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] leading-5 text-ink">{t("people.title")}</div>
            <div className="text-[13px] leading-[18px] text-ink-secondary">{t("settings.simple.people")}</div>
          </div>
          <button type="button" aria-expanded={open} className="ui-button shrink-0" onClick={() => setOpen(!open)}>
            {open ? t("common.done") : t("settings.simple.people.invite")}
          </button>
        </div>
        {open && <div className="px-3.5 pb-3.5 pt-1">{portal ?? content}</div>}
      </div>
    );
  }
  return portal ?? <Card title={t("people.title")} subtitle={t("people.subtitle")}>{content}</Card>;
}
