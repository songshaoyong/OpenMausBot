import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Card } from "./SettingsPrimitives";
import { api, useStore, type ConfigStatus } from "@/state/store";

interface IncusStatus {
  configured?: boolean;
  url?: string;
  project?: string;
  image?: string;
  viewerUrl?: string;
}

interface IncusInstance {
  name: string;
  botId: string | null;
  state: string;
}

interface IncusInventory {
  available: boolean;
  problem: string | null;
  instances: IncusInstance[];
}

/** The Incus server that hosts bots' container desktops; certificates are write-only once saved. */
export function IncusSettingsCard() {
  const { state, dispatch } = useStore();
  const status = state.config?.incus as IncusStatus | undefined;
  const [url, setUrl] = useState(status?.url ?? "");
  const [project, setProject] = useState(status?.project ?? "default");
  const [image, setImage] = useState(status?.image ?? "");
  const [viewerUrl, setViewerUrl] = useState(status?.viewerUrl ?? "");
  const [clientCert, setClientCert] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [serverCert, setServerCert] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [instances, setInstances] = useState<IncusInstance[]>([]);
  const [inventoryProblem, setInventoryProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const payload = await api<IncusInventory>("/api/computers/incus");
      setInstances(Array.isArray(payload.instances) ? payload.instances : []);
      setInventoryProblem(payload.problem ?? null);
    } catch (e) {
      setInventoryProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!status?.configured) return;
    let alive = true;
    setLoading(true);
    api<IncusInventory>("/api/computers/incus")
      .then((payload) => {
        if (!alive) return;
        setInstances(Array.isArray(payload.instances) ? payload.instances : []);
        setInventoryProblem(payload.problem ?? null);
      })
      .catch((e) => {
        if (alive) setInventoryProblem(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status?.configured]);

  const remove = async (name: string) => {
    if (!window.confirm(t("computer.incus.confirmRemove", { name }))) return;
    setRemoving(name);
    setError(null);
    try {
      await api(`/api/computers/incus/${encodeURIComponent(name)}/remove`, {
        method: "POST",
        body: JSON.stringify({ confirmName: name }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({
          incus: {
            url: url.trim(),
            project: project.trim() || "default",
            ...(image.trim() ? { image: image.trim() } : {}),
            viewerUrl: viewerUrl.trim(),
            ...(clientCert.trim() ? { clientCert: clientCert.trim() } : {}),
            ...(clientKey.trim() ? { clientKey: clientKey.trim() } : {}),
            ...(serverCert.trim() ? { serverCert: serverCert.trim() } : {}),
          },
        }),
      });
      dispatch({ type: "configStatus", config });
      setClientCert("");
      setClientKey("");
      setServerCert("");
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const field = "mt-1 w-full rounded-lg bg-inset px-3 py-2 font-mono text-[12px] text-ink outline-none";

  return (
    <Card title={t("computer.incus.title")} subtitle={t("computer.incus.subtitle")}>
      <div className="text-[12px] text-ink-secondary">
        {status?.configured ? t("computer.incus.configured", { url: status.url ?? url }) : t("computer.incus.needsConfig")}
      </div>

      <label className="mt-3 block text-[12px] text-ink-secondary">
        {t("computer.incus.url")}
        <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://host.docker.internal:8443" />
      </label>
      <label className="mt-2 block text-[12px] text-ink-secondary">
        {t("computer.incus.project")}
        <input className={field} value={project} onChange={(e) => setProject(e.target.value)} placeholder="default" />
      </label>
      <label className="mt-2 block text-[12px] text-ink-secondary">
        {t("computer.incus.image")}
        <input className={field} value={image} onChange={(e) => setImage(e.target.value)} placeholder="openmausbot-desktop" />
      </label>
      <label className="mt-2 block text-[12px] text-ink-secondary">
        {t("computer.incus.viewerUrl")}
        <input
          className={field}
          value={viewerUrl}
          onChange={(e) => setViewerUrl(e.target.value)}
          placeholder="http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale"
        />
      </label>
      <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("computer.incus.viewerUrlHint")}</p>
      <label className="mt-2 block text-[12px] text-ink-secondary">
        {t("computer.incus.clientCert")}
        <textarea className={`${field} h-24`} value={clientCert} onChange={(e) => setClientCert(e.target.value)} />
      </label>
      <label className="mt-2 block text-[12px] text-ink-secondary">
        {t("computer.incus.clientKey")}
        <textarea className={`${field} h-24`} value={clientKey} onChange={(e) => setClientKey(e.target.value)} />
      </label>
      <label className="mt-2 block text-[12px] text-ink-secondary">
        {t("computer.incus.serverCert")}
        <textarea className={`${field} h-16`} value={serverCert} onChange={(e) => setServerCert(e.target.value)} />
      </label>

      {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
      {saved && <div className="mt-3 text-[12px] text-ink-secondary">{t("computer.incus.saved")}</div>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !url.trim()}
        className="mt-3 flex items-center gap-2 rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:brightness-110 disabled:opacity-40"
      >
        {saving && <Loader2 size={12} className="animate-spin" />} {t("computer.incus.save")}
      </button>

      {status?.configured && (
        <div className="mt-5 border-t border-hairline/40 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] font-medium text-ink">{t("computer.incus.computers")}</div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading || removing !== null}
              aria-label={t("computer.incus.refresh")}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
            >
              <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {t("computer.incus.refresh")}
            </button>
          </div>
          {inventoryProblem && <div role="alert" className="mt-2 text-[12px] text-danger">{inventoryProblem}</div>}
          {instances.length === 0 && !inventoryProblem && (
            <div className="mt-2 text-[12px] text-ink-secondary">{t("computer.incus.none")}</div>
          )}
          {instances.map((instance) => (
            <div key={instance.name} className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] text-ink">{instance.name}</div>
                <div className="text-[12px] text-ink-secondary">
                  {instance.state}
                  {instance.botId ? ` · ${instance.botId}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove(instance.name)}
                disabled={removing !== null}
                aria-label={t("computer.incus.remove", { name: instance.name })}
                className="shrink-0 rounded-lg border border-hairline/40 p-1.5 text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-40"
              >
                {removing === instance.name ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
