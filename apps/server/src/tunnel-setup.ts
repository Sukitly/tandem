/**
 * The Cloudflare half of publishing this machine, done here rather than by hand. Two roles, deliberately separate,
 * because only one of them needs authority over the account:
 *
 * - `createTunnelHere` runs where account authority is acceptable — your own machine. It authorizes cloudflared
 *   once, creates the tunnel, points a hostname at it, and hands back the token that runs that one tunnel.
 * - `setupTunnel` does all of that and then writes this machine's own configuration, for when the machine running
 *   Tandem is yours alone. On a machine you share, the host gets the token instead, and never the authority.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_PORT } from "@tandem/contracts";
import { CLOUDFLARED, cloudflaredCapture, cloudflaredMissing, cloudflaredRun } from "./cloudflared.ts";
import { defaultStateDirPath } from "./state-dir.ts";
import { checkedPublicUrl, saveTunnelConfig } from "./tunnel-config.ts";
import { credentialsPath, originCertPath, tunnelFileYaml, tunnelFileYamlPath } from "./tunnel-file.ts";

/** The name the tunnel is created under, and the name it is found by on a second run. */
const TUNNEL_NAME = "tandem";

/** What either role needs: where it is published, and how to talk about it. */
export interface TunnelSetupOptions {
  /** The HTTPS origin the tunnel publishes; its host is the hostname pointed at the tunnel. */
  readonly publicUrl: string;
  readonly name?: string;
  readonly executable?: string;
  /** Point a hostname that already has a record at this tunnel, replacing what that record says now. */
  readonly force?: boolean;
  readonly home?: string;
  readonly report: (line: string) => void;
  /** The URL the person approves this machine at, as cloudflared prints it while it waits. */
  readonly onAuthorizationUrl?: (url: string) => void;
  readonly signal?: AbortSignal;
}

export interface SetupOptions extends TunnelSetupOptions {
  readonly stateDir?: string;
}

export interface SetupResult {
  readonly tunnelId: string;
  /** Tandem's own record of the public origin. */
  readonly configPath: string;
  /** The configuration cloudflared reads. */
  readonly tunnelFile: string;
}

export interface CreatedTunnel {
  readonly tunnelId: string;
  /** The connector token: it runs this one tunnel and grants nothing else. */
  readonly token: string;
}

/**
 * Creates the tunnel and its DNS record, and returns the token that runs it. Nothing about this machine is written:
 * the point of this role is to hand a token to the machine that will run the tunnel, and keep the authority here.
 */
export async function createTunnelHere(options: TunnelSetupOptions): Promise<CreatedTunnel> {
  const { executable, tunnelId, hostname } = await ensureTunnel(options);
  routeDns(executable, tunnelId, hostname, options.force ?? false, options.report);
  return { tunnelId, token: readToken(executable, tunnelId) };
}

/** The same work, and then this machine's own configuration: the tunnel runs here, so it needs the credentials. */
export async function setupTunnel(options: SetupOptions): Promise<SetupResult> {
  const stateDir = options.stateDir ?? defaultStateDirPath();
  const { executable, tunnelId, hostname } = await ensureTunnel(options);
  options.signal?.throwIfAborted();
  routeDns(executable, tunnelId, hostname, options.force ?? false, options.report);

  const tunnelFile = tunnelFileYamlPath(stateDir);
  await mkdir(dirname(tunnelFile), { recursive: true });
  await writeFile(
    tunnelFile,
    tunnelFileYaml({
      tunnelId,
      credentialsFile: credentialsPath(tunnelId, options.home),
      hostname,
      port: DEFAULT_PORT,
    }),
  );
  options.signal?.throwIfAborted();
  const configPath = await saveTunnelConfig({ publicUrl: options.publicUrl }, stateDir);
  options.report(`Wrote ${configPath} and ${tunnelFile}`);
  return { tunnelId, configPath, tunnelFile };
}

/** Authorize this machine if it is not already, then find the tunnel of that name or make one. */
async function ensureTunnel(
  options: TunnelSetupOptions,
): Promise<{ executable: string; tunnelId: string; hostname: string }> {
  options.signal?.throwIfAborted();
  const executable = options.executable ?? CLOUDFLARED;
  const name = options.name ?? TUNNEL_NAME;
  if (cloudflaredMissing(executable))
    throw new Error(`${executable} is not installed. Install it with \`brew install cloudflared\`, then try again.`);
  const hostname = new URL(checkedPublicUrl(options.publicUrl)).hostname;

  if (!existsSync(originCertPath(options.home))) {
    options.report("Authorizing this machine with Cloudflare: a browser window opens, and the rest is automatic.");
    await cloudflaredRun(
      executable,
      ["tunnel", "login"],
      (line) => {
        options.report(line);
        const url = /https:\/\/\S+/.exec(line)?.[0];
        if (url !== undefined) options.onAuthorizationUrl?.(url);
      },
      options.signal,
    );
  }

  options.signal?.throwIfAborted();
  const existing = listTunnels(executable, name);
  const tunnelId = existing[0] ?? (await createTunnel(executable, name, options.report, options.signal));
  options.report(existing[0] === undefined ? `Created the tunnel ${name}.` : `Using the tunnel ${name}.`);
  return { executable, tunnelId, hostname };
}

/** The tunnels of that name, which is at most one: a name is unique within an account. */
function listTunnels(executable: string, name: string): string[] {
  const listed = cloudflaredCapture(executable, ["tunnel", "list", "--name", name, "--output", "json"]);
  if (!listed.ok) throw new Error(`Could not list tunnels: cloudflared exited with an error.\n${listed.output.trim()}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(listed.stdout);
  } catch {
    throw new Error(`Could not read the tunnel list. cloudflared printed:\n${listed.output.trim()}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`Could not read the tunnel list: ${listed.output.trim()}`);
  return parsed
    .filter((item): item is { id: string } => typeof (item as { id?: unknown }).id === "string")
    .map((item) => item.id);
}

async function createTunnel(
  executable: string,
  name: string,
  report: (line: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  await cloudflaredRun(executable, ["tunnel", "create", name], report, signal);
  signal?.throwIfAborted();
  const created = listTunnels(executable, name);
  if (created[0] === undefined) throw new Error(`cloudflared created no tunnel named ${name}`);
  return created[0];
}

/** The DNS record that carries the hostname to the tunnel; cloudflared refuses when one is already there. */
function routeDns(
  executable: string,
  tunnelId: string,
  hostname: string,
  force: boolean,
  report: (line: string) => void,
): void {
  const routed = cloudflaredCapture(executable, [
    "tunnel",
    "route",
    "dns",
    ...(force ? ["--overwrite-dns"] : []),
    tunnelId,
    hostname,
  ]);
  if (routed.ok) {
    report(`${hostname} now points at this tunnel.`);
    return;
  }
  if (/already exists|record with that host/i.test(routed.output))
    throw new Error(
      `${hostname} already has a DNS record. Run ` +
        "`bun run tunnel setup --force` to point it at this tunnel instead.",
    );
  throw new Error(`Could not point ${hostname} at the tunnel.\n${routed.output.trim()}`);
}

/** cloudflared prints the connector token for that tunnel, which is what the host machine runs it with. */
function readToken(executable: string, tunnelId: string): string {
  const printed = cloudflaredCapture(executable, ["tunnel", "token", tunnelId]);
  const token = printed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  if (!printed.ok || token === undefined || /\s/.test(token))
    throw new Error(`Could not read the tunnel token.\n${printed.output.trim()}`);
  return token;
}
