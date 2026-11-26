// The names the desktop proxy (`/api/desktop-viewer/<target>`) serves: one rule for the server and the renderer.

/** A Local VM is `local/shared`, `local/bot-<sha256>`, `local/shared-desktop-<sha256>` or `local/pool-<seat>`; a bot's VPS is `vps/<botId>`.
 * Every consumer builds its route from this one body, so a desktop kind added here is served everywhere at once. */
export const DESKTOP_VIEWER_TARGET_BODY = String.raw`local\/(?:shared|bot-[a-f0-9]{64}|shared-desktop-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+`;

export const DESKTOP_VIEWER_TARGET = new RegExp(`^(?:${DESKTOP_VIEWER_TARGET_BODY})$`);

/** A Local VM's proxy name, from its target key (`shared`, `bot:<sha256>`, `shared-desktop:<sha256>` or `pool:<seat>`). */
export const viewerTargetId = (target: { key: string }) => `local/${target.key.replace(":", "-")}`;
