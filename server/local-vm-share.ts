// The links a person sends to someone else: the desktop's own viewer page, and the one address the
// desktop's reverse proxy answers on. Both are derived, never typed: the viewer password changes with
// every recreated container, so a copied link would go stale if it were stored.
import type { AppConfig } from "./config.ts";
import type { ContainerComputerStatus } from "./container-computer.ts";

export interface LocalVmShare {
  /** The viewer page, with the password the container has right now. */
  viewer: string | null;
  /** Where a service published from the desktop answers, if the operator set a service port. */
  services: string | null;
}

export function localVmShare(
  status: Pick<ContainerComputerStatus, "viewer_url" | "container">,
  cfg: AppConfig,
): LocalVmShare | null {
  const share = cfg.localVm?.share;
  if (!share) return null;
  const base = share.baseUrl.replace(/\/+$/, "");
  const viewerPassword = status.viewer_url
    ? new URLSearchParams(new URL(status.viewer_url).hash.slice(1)).get("password")
    : null;
  const viewer = share.viewerPort && viewerPassword && status.container === "running"
    ? `${base}:${share.viewerPort}/vnc.html#autoconnect=true&resize=scale&password=${encodeURIComponent(viewerPassword)}`
    : null;
  const services = share.servicePort ? `${base}:${share.servicePort}/` : null;
  return { viewer, services };
}
