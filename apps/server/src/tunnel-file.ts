import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkedIdentity, DEFAULT_HOST, DEFAULT_PORT, type TunnelIdentity } from "@tandem/contracts";
import { defaultStateDirPath } from "./state-dir.ts";

/**
 * A tunnel this machine manages itself, rather than one a dashboard describes. The ingress lives here, so the
 * hostname is one Tandem knows and the DNS record is one Tandem can create, with no token to copy by hand.
 */
export interface LocalTunnel {
  readonly tunnelId: string;
  /** The credentials `cloudflared tunnel create` wrote, named after the tunnel. */
  readonly credentialsFile: string;
  readonly hostname: string;
  readonly port?: number;
}

/** cloudflared's own directory: the origin certificate from `login`, and the credentials of each tunnel. */
function cloudflaredHome(home?: string): string {
  return join(home ?? process.env.HOME ?? "", ".cloudflared");
}

/** The certificate that proves this machine may manage a zone, written by `cloudflared tunnel login`. */
export function originCertPath(home?: string): string {
  return join(cloudflaredHome(home), "cert.pem");
}

export function credentialsPath(tunnelId: string, home?: string): string {
  return join(cloudflaredHome(home), `${tunnelId}.json`);
}

/** Where Tandem writes the tunnel's own configuration, which cloudflared reads with `--config`. */
export function tunnelFileYamlPath(stateDir: string = defaultStateDirPath()): string {
  return join(stateDir, "cloudflared.yml");
}

/**
 * The configuration cloudflared reads. One ingress rule sends the public hostname to this machine's server, and a
 * second refuses everything else: the tunnel publishes one port and answers nothing it was not asked to answer.
 */
export function tunnelFileYaml(tunnel: LocalTunnel): string {
  const origin = `http://${DEFAULT_HOST}:${tunnel.port ?? DEFAULT_PORT}`;
  return [
    "# Written by Tandem. `bun run tunnel setup` replaces it; edit that instead.",
    `tunnel: ${tunnel.tunnelId}`,
    `credentials-file: ${tunnel.credentialsFile}`,
    "no-autoupdate: true",
    "",
    "ingress:",
    `  - hostname: ${tunnel.hostname}`,
    `    service: ${origin}`,
    "  - service: http_status:404",
    "",
  ].join("\n");
}

/**
 * Which tunnel the file this machine wrote runs: its ID from the file, its account from the credentials the file
 * names. `undefined` when either cannot be read, since this only serves a link to the dashboard.
 */
export async function localTunnelIdentity(stateDir?: string): Promise<TunnelIdentity | undefined> {
  try {
    const yaml = await readFile(tunnelFileYamlPath(stateDir), "utf8");
    const tunnelId = /^tunnel:\s*(\S+)\s*$/m.exec(yaml)?.[1];
    const credentialsFile = /^credentials-file:\s*(.+?)\s*$/m.exec(yaml)?.[1];
    if (tunnelId === undefined || credentialsFile === undefined) return undefined;
    const credentials = JSON.parse(await readFile(credentialsFile, "utf8")) as { AccountTag?: unknown };
    return checkedIdentity(credentials.AccountTag, tunnelId);
  } catch {
    return undefined;
  }
}
