import { type Context, defineService, type ReplicatedState } from "@earendil-works/chord";
import type { TunnelState } from "./index.ts";

/**
 * Where publishing this machine on the public internet has got to, as a page shows it: nothing yet, waiting for a
 * person to approve this machine in a browser, the tunnel process starting or connected, or a reason it is not.
 */
export type PublicAccessStatus = "none" | "authorizing" | "starting" | TunnelState;

export interface PublicAccessState {
  readonly status: PublicAccessStatus;
  /** The HTTPS origin the tunnel publishes, which is also this server's public origin. */
  readonly publicUrl?: string;
  /** Where to approve this machine, while `authorizing`. */
  readonly authorizationUrl?: string;
  /** What went wrong, in one line, when something did. */
  readonly message?: string;
  /** Whether the `cloudflared` program is on this machine, so a page can say to install it. */
  readonly cloudflared: boolean;
  /** The tunnel that is configured here, when Tandem can tell which one, so a page can link to its dashboard. */
  readonly tunnel?: TunnelIdentity;
}

/**
 * Which Cloudflare account and tunnel a connector runs. Neither is a secret: the tunnel ID is in the hostname's DNS
 * record. Together they name the dashboard pages about that tunnel.
 */
export interface TunnelIdentity {
  readonly accountId: string;
  readonly tunnelId: string;
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/i;
const TUNNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the account and tunnel out of a connector token, which is base64 of `{"a": account, "t": tunnel, "s":
 * secret}`. `undefined` for anything else, since the token's shape is Cloudflare's and not a promise.
 */
export function tunnelTokenIdentity(token: string): TunnelIdentity | undefined {
  try {
    const decoded: unknown = JSON.parse(atob(token.trim().replaceAll("-", "+").replaceAll("_", "/")));
    return checkedIdentity((decoded as { a?: unknown })?.a, (decoded as { t?: unknown })?.t);
  } catch {
    return undefined;
  }
}

/** An identity only when both parts look like Cloudflare's, so that neither can bend a dashboard URL. */
export function checkedIdentity(accountId: unknown, tunnelId: unknown): TunnelIdentity | undefined {
  if (typeof accountId !== "string" || typeof tunnelId !== "string") return undefined;
  if (!ACCOUNT_ID.test(accountId) || !TUNNEL_ID.test(tunnelId)) return undefined;
  return { accountId: accountId.toLowerCase(), tunnelId: tunnelId.toLowerCase() };
}

/**
 * Reaching this machine from the public internet, through a Cloudflare tunnel Tandem runs as a child of the server.
 * Setting one up authorizes this machine once in a browser; after that the work is Cloudflare's own commands.
 */
/** What publishing needs: the address, and the token of a tunnel a dashboard describes. */
export interface PublishInput {
  readonly publicUrl: string;
  /**
   * The connector token of a tunnel created in the dashboard, which runs that one tunnel and grants nothing else.
   * Absent means this machine manages the tunnel itself, which requires authorizing it with cloudflared first.
   */
  readonly token?: string;
}

export interface PublicAccess {
  readonly state: ReplicatedState<PublicAccessState>;
  /**
   * Publishes at that origin, creating the tunnel when this machine has none. Returns when the work has started, not
   * when it is done: authorization is a browser step, so the state carries the URL to open and the rest follows.
   */
  publish(input: PublishInput, context: Context): Promise<void>;
  /** Stops publishing here. The tunnel and its DNS record stay in Cloudflare, so publishing again is one step. */
  unpublish(context: Context): Promise<void>;
}
export const PublicAccess = defineService<PublicAccess>("tandem.public-access");
