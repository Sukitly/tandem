import { type Context, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { PublicAccess, PublicAccessState, PublicAccessStatus } from "@tandem/contracts";
import { checkedPublicUrl } from "../tunnel-config.ts";
import type { TunnelControl } from "../tunnel-control.ts";
import { invalidInput } from "./errors.ts";

/**
 * The page's view of publishing this machine. The tunnel is one for the whole server, so this service only reads the
 * control and asks it to change: the state it replicates is the control's own view, pushed as the control changes.
 */
export function createPublicAccessService(control: TunnelControl): PublicAccess {
  const state = replicatedState<PublicAccessState>(snapshot(control));
  control.onChange(() => state.replace(BACKGROUND_CONTEXT, snapshot(control)));
  return {
    state,
    publish: async (input: unknown, _context: Context) => {
      const { publicUrl, token } = (input ?? {}) as { publicUrl?: unknown; token?: unknown };
      if (typeof publicUrl !== "string" || publicUrl.length > 200) throw invalidInput("A public origin is required");
      if (token !== undefined && (typeof token !== "string" || token.trim().length === 0 || token.length > 4096))
        throw invalidInput("The tunnel token is not valid");
      try {
        // Validate here so that a typo is the caller's error rather than a failure state the page must explain.
        checkedPublicUrl(publicUrl);
      } catch (error) {
        throw invalidInput(error instanceof Error ? error.message : String(error));
      }
      try {
        await control.publish(token === undefined ? { publicUrl } : { publicUrl, token: token.trim() });
      } catch (error) {
        throw invalidInput(error instanceof Error ? error.message : String(error));
      }
    },
    unpublish: async (_context: Context) => control.unpublish(),
  };
}

function snapshot(control: TunnelControl): PublicAccessState {
  const view = control.view;
  return {
    status: view.status as PublicAccessStatus,
    cloudflared: control.cloudflared,
    ...(view.publicUrl === undefined ? {} : { publicUrl: view.publicUrl }),
    ...(view.authorizationUrl === undefined ? {} : { authorizationUrl: view.authorizationUrl }),
    ...(view.message === undefined ? {} : { message: view.message }),
    ...(view.tunnel === undefined ? {} : { tunnel: view.tunnel }),
  };
}
