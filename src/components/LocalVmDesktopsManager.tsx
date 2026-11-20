import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Play, Plus, Square, Trash2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";

interface DesktopUser {
  id: string;
  name: string;
}

type DesktopDestination = "auto" | "cloud" | "vm" | "local" | "browser" | "off";

interface DesktopRow {
  kind: "shared" | "bot";
  id: string;
  botId?: string;
  name: string;
  container: "running" | "stopped" | "missing" | null;
  ready: boolean;
  managed?: boolean;
  problem?: string | null;
  inUse?: boolean;
  destination?: DesktopDestination;
  users: DesktopUser[];
  canMigrate: boolean;
}

interface DesktopsPayload {
  desktops: DesktopRow[];
  maxInstances: number;
  available: boolean;
  problem: string | null;
}

const destinationLabelKeys = {
  auto: "vm.dest.auto",
  cloud: "place.cloud",
  vm: "vm.dest.vm",
  local: "vm.dest.local",
  browser: "vm.dest.browser",
  off: "vm.dest.off",
} as const;

function confirmMessage(message: string): Promise<boolean> {
  return window.ogb?.confirm ? window.ogb.confirm(message) : Promise.resolve(window.confirm(message));
}

function rowStatus(row: DesktopRow): { label: string; tone: "running" | "stopped" | "missing" | "warning" } {
  if (row.kind === "bot" && row.managed === false) return { label: t("vm.state.notManaged"), tone: "warning" };
  if (row.inUse) return { label: t("vm.state.inUse"), tone: "running" };
  if (row.container === "running") {
    return row.ready ? { label: t("vm.shared.running"), tone: "running" } : { label: t("vm.shared.starting"), tone: "running" };
  }
  if (row.container === "stopped") return { label: t("vm.shared.stopped"), tone: "stopped" };
  return { label: t("vm.shared.missing"), tone: "missing" };
}

/** One inventory of real desktop containers: shared desktops and independent per-bot desktops. */
export function LocalVmDesktopsManager() {
  const owner = useOwnerOrAdmin();
  const [name, setName] = useState("");
  const [rows, setRows] = useState<DesktopRow[]>([]);
  const [maxInstances, setMaxInstances] = useState(2);
  const [available, setAvailable] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await api<DesktopsPayload>("/api/local-computer/desktops");
      setRows(payload.desktops);
      setMaxInstances(payload.maxInstances);
      setAvailable(payload.available);
      setProblem(payload.problem);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("vm.shared.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, request: () => Promise<DesktopsPayload>) => {
    setBusy(key);
    setError("");
    try {
      const payload = await request();
      setRows(payload.desktops);
      setMaxInstances(payload.maxInstances);
      setAvailable(payload.available);
      setProblem(payload.problem);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("vm.shared.actionError"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const value = name.trim();
    const sharedCount = rows.filter((row) => row.kind === "shared").length;
    if (!value || busy || sharedCount >= maxInstances) return;
    if (await run("create", () => api("/api/local-computer/shared-desktops", {
      method: "POST",
      body: JSON.stringify({ name: value }),
    }))) setName("");
  };

  const sharedAction = async (row: DesktopRow, action: "start" | "stop" | "remove") => {
    if (action === "remove" && !(await confirmMessage(t("vm.unified.confirmDeleteShared", { name: row.name })))) return;
    await run(`${row.id}:${action}`, () => api(`/api/local-computer/shared-desktops/${row.id}/${action}`, {
      method: "POST",
      body: "{}",
    }));
  };

  const deleteBotDesktop = async (row: DesktopRow) => {
    if (!row.botId) return;
    if (!(await confirmMessage(t("vm.confirm.deleteBotVm", { name: row.name })))) return;
    await run(`${row.id}:remove`, () => api(`/api/bots/${row.botId}/local-computer/remove`, {
      method: "POST",
      body: "{}",
    }));
  };

  const migrate = async (row: DesktopRow) => {
    if (!row.botId) return;
    if (!(await confirmMessage(t("vm.unified.confirmMigrate", { name: row.name })))) return;
    await run(`${row.id}:migrate`, () => api("/api/local-computer/desktops/migrate", {
      method: "POST",
      body: JSON.stringify({ botId: row.botId, name: row.name }),
    }));
  };

  const locked = busy !== null || owner !== true;
  const sharedCount = rows.filter((row) => row.kind === "shared").length;
  const botCount = rows.filter((row) => row.kind === "bot").length;
  return (
    <Card
      title={t("vm.unified.title")}
      subtitle={available
        ? t("vm.unified.counts", { shared: sharedCount, bot: botCount, max: maxInstances })
        : t("vm.unified.subtitle")}
    >
      <div className="flex flex-col gap-3" aria-busy={busy !== null || loading}>
        {!available && problem && <p className="text-[12px] text-ink-secondary">{problem}</p>}
        {loading ? <p className="text-[12px] text-ink-secondary">{t("vm.shared.loading")}</p> : null}
        {!loading && !rows.length ? <p className="text-[12px] leading-5 text-ink-secondary">{t("vm.unified.empty")}</p> : null}
        {!loading && rows.length > 0 && (
          <div className="divide-y divide-hairline/40 rounded-xl border border-hairline/50 bg-panel/40">
            {rows.map((row) => {
              const status = rowStatus(row);
              const rowBusy = busy?.startsWith(`${row.id}:`) === true;
              const running = row.container === "running";
              const users = row.users.map((user) => user.name).join(", ");
              const canDelete = row.kind === "shared" ? row.users.length === 0 : row.managed === true && !row.inUse;
              return (
                <div key={`${row.kind}:${row.id}`} className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink" title={row.name}>{row.name}</span>
                        <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-secondary">
                          {t(row.kind === "shared" ? "vm.unified.shared" : "vm.unified.independent")}
                        </span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${status.tone === "running" ? "bg-emerald-500/10 text-emerald-600" : status.tone === "stopped" ? "bg-ink/5 text-ink-secondary" : status.tone === "warning" ? "bg-amber-500/10 text-amber-700" : "bg-amber-500/10 text-amber-700"}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="truncate text-[12px] text-ink-secondary" title={users}>
                        {row.kind === "shared"
                          ? users ? t("vm.shared.usedBy", { names: users }) : t("vm.shared.unused")
                          : row.destination ? t("vm.unified.destination", { destination: t(destinationLabelKeys[row.destination]) }) : t("vm.unified.independentDesktop")}
                      </div>
                      {row.problem && !row.inUse && <div className="mt-1 text-[11px] text-warning">{row.problem}</div>}
                      {row.inUse && <div className="mt-1 text-[11px] text-ink-secondary">{t("vm.perBot.stopFirst")}</div>}
                    </div>
                    {row.kind === "shared" && !running && (
                      <button type="button" disabled={locked || rowBusy} onClick={() => void sharedAction(row, "start")} aria-label={t("vm.shared.startAria", { name: row.name })} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-control disabled:opacity-50">
                        <Play size={13} />{t("vm.shared.start")}
                      </button>
                    )}
                    {row.kind === "shared" && running && (
                      <button type="button" disabled={locked || rowBusy} onClick={() => void sharedAction(row, "stop")} aria-label={t("vm.shared.stopAria", { name: row.name })} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-control disabled:opacity-50">
                        <Square size={12} />{t("vm.shared.stop")}
                      </button>
                    )}
                    {row.kind === "bot" && row.canMigrate && (
                      <button type="button" disabled={locked || rowBusy} onClick={() => void migrate(row)} title={t("vm.unified.migrateTitle", { name: row.name })} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-control disabled:opacity-50">
                        <ArrowRightLeft size={13} />{t("vm.unified.migrate")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={locked || rowBusy || !canDelete}
                      onClick={() => void (row.kind === "shared" ? sharedAction(row, "remove") : deleteBotDesktop(row))}
                      aria-label={t("vm.shared.deleteAria", { name: row.name })}
                      title={canDelete ? undefined : t("vm.unified.deleteBlocked")}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 size={13} />{t("common.delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            required
            disabled={locked || sharedCount >= maxInstances}
            placeholder={t("vm.shared.namePlaceholder")}
            aria-label={t("vm.shared.nameAria")}
            className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent-border disabled:opacity-50"
          />
          <button type="submit" disabled={locked || !name.trim() || sharedCount >= maxInstances} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50">
            <Plus size={14} />{t("vm.shared.create")}
          </button>
        </form>
        {sharedCount >= maxInstances && <p className="text-[12px] text-ink-secondary">{t("vm.shared.limit", { max: maxInstances })}</p>}
        {owner === false && <p className="text-[12px] text-ink-secondary">{t("vm.shared.ownerOnly")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
