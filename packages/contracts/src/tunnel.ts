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
