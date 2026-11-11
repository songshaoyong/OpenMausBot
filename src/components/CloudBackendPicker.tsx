import type { CloudBackend } from "../../shared/wire";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";

const BACKENDS = ["box", "vps", "incus"] as const;

function backendLabel(backend: CloudBackend): string {
  if (backend === "vps") return t("botAccess.cloud.selfHostedVps");
  if (backend === "incus") return t("botAccess.cloud.incus");
  return t("botAccess.cloud.boat");
}

function backendDescription(backend: CloudBackend, compact: boolean): string {
  if (backend === "vps") return compact ? t("botAccess.cloud.vpsDescription") : t("botAccess.cloud.vpsAutoDescription");
  if (backend === "incus") return compact ? t("botAccess.cloud.incusDescription") : t("botAccess.cloud.incusAutoDescription");
  return compact ? t("botAccess.cloud.hostedDescription") : t("botAccess.cloud.hostedBackendDescription");
}

export function CloudBackendPicker({
  value,
  compact = false,
  onChange,
}: {
  value: CloudBackend;
  compact?: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  const { state } = useStore();
  if (state.config?.cloudHome) return null;
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">{compact ? t("botAccess.cloud.provider") : t("botAccess.cloud.backend")}</div>
      <div className="mt-0.5 text-[12px] text-ink-secondary">{backendDescription(value, compact)}</div>
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {BACKENDS.map((backend, i) => (
          <button
            key={backend}
            onClick={() => onChange(backend)}
            className={cn(
              "flex-1 py-1.5 text-[12px]",
              i > 0 && "border-l border-hairline/40",
              value === backend ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
            )}
          >
            {backendLabel(backend)}
          </button>
        ))}
      </div>
    </div>
  );
}
