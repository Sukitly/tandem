import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJsonFile, writeJsonFile } from "./json-file.ts";
import { publicOrigin } from "./server.ts";
import { defaultStateDirPath } from "./state-dir.ts";

/**
 * Access to this machine from the public internet, through a Cloudflare tunnel. A tunnel this machine manages itself
 * is described by `cloudflared.yml` beside this file; one a dashboard describes additionally has a connector token.
 * Either way the published origin is this server's public origin.
 */
export interface TunnelConfig {
  /** The HTTPS origin the tunnel publishes, which is also this server's public origin. */
  readonly publicUrl: string;
  /**
   * The connector token of a tunnel a dashboard describes. Absent for a tunnel this machine manages itself, whose
   * configuration is `cloudflared.yml` beside this file: there is no token to keep in that case.
   */
  readonly token?: string;
}

export function tunnelConfigPath(stateDir: string = defaultStateDirPath()): string {
  return join(stateDir, "tunnel.json");
}

/** `undefined` when this installation runs no tunnel. */
export async function loadTunnelConfig(stateDir?: string): Promise<TunnelConfig | undefined> {
  const path = tunnelConfigPath(stateDir);
  const stored = await readJsonFile(path);
  if (stored === undefined) return undefined;
  const value = stored as Partial<TunnelConfig>;
  if (typeof value.publicUrl !== "string") throw new Error(`${path} needs a publicUrl`);
  return {
    publicUrl: checkedPublicUrl(value.publicUrl),
    ...(typeof value.token === "string" ? { token: checkedToken(value.token) } : {}),
  };
}

/** Writes the configuration at the state directory's usual 0600, and returns where it went. */
export async function saveTunnelConfig(config: TunnelConfig, stateDir?: string): Promise<string> {
  const path = tunnelConfigPath(stateDir);
  const checked: TunnelConfig = {
    publicUrl: checkedPublicUrl(config.publicUrl),
    ...(config.token === undefined ? {} : { token: checkedToken(config.token) }),
  };
  // The state directory holds the master key, so it is created at 0700, like the installer creates it.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeJsonFile(path, checked);
  return path;
}

/** A public origin must be an HTTPS origin: cookies are marked `Secure` by matching this host. */
export function checkedPublicUrl(value: string): string {
  try {
    return publicOrigin(value);
  } catch (error) {
    throw new Error(`public-url must be an HTTPS origin, for example https://tandem.example.com`, { cause: error });
  }
}

/** A token is pasted from the dashboard, so its surrounding whitespace is not part of it. */
function checkedToken(value: string): string {
  const token = value.trim();
  if (token === "") throw new Error("The tunnel token is empty");
  if (/\s/.test(token)) throw new Error("The tunnel token contains whitespace");
  return token;
}
