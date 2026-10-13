import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./json-file.ts";
import { publicOrigin } from "./server.ts";
import { defaultStateDirPath } from "./state-dir.ts";

/**
 * Access to this machine from the public internet, through a Cloudflare tunnel the user created: the origin the
 * tunnel publishes, and the token that runs it. Both are the user's to supply; Tandem only reads and keeps them.
 */
export interface TunnelConfig {
  /** The HTTPS origin the tunnel publishes, which is also this server's public origin. */
  readonly publicUrl: string;
  /** The Cloudflare tunnel token. It runs that one tunnel and nothing else, and the dashboard revokes it. */
  readonly token: string;
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
  if (typeof value.publicUrl !== "string" || typeof value.token !== "string")
    throw new Error(`${path} needs both publicUrl and token`);
  return { publicUrl: checkedPublicUrl(value.publicUrl), token: checkedToken(value.token) };
}

/** Writes the configuration at the state directory's usual 0600, and returns where it went. */
export async function saveTunnelConfig(config: TunnelConfig, stateDir?: string): Promise<string> {
  const path = tunnelConfigPath(stateDir);
  const checked: TunnelConfig = {
    publicUrl: checkedPublicUrl(config.publicUrl),
    token: checkedToken(config.token),
  };
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
