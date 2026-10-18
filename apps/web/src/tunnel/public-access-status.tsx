import type { PublicAccessState } from "@tandem/contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { cloudflareLinks } from "./cloudflare.ts";
import { OpenLink } from "./step.tsx";

export function PublicAccessStatus({
  state,
  activeTunnel,
}: {
  state: PublicAccessState | undefined;
  activeTunnel: { accountId: string; tunnelId: string } | undefined;
}) {
  const installed = state?.cloudflared ?? false;
  const status = state?.status ?? "none";

  if (!installed) return null;

  return (
    <>
      {status === "authorizing" && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="flex items-center gap-2">
            <Spinner /> Waiting for you to approve this machine in the browser.
          </p>
          {state?.authorizationUrl !== undefined && (
            <a className="underline" href={state.authorizationUrl} target="_blank" rel="noreferrer">
              Open the Cloudflare approval page
            </a>
          )}
        </div>
      )}

      {status === "starting" && (
        <p className="flex items-center gap-2 text-sm">
          <Spinner /> Starting the tunnel…
        </p>
      )}

      {status === "connected" && (
        <Alert>
          <AlertTitle>
            Tunnel connected for <span className="font-medium">{state?.publicUrl}</span>
          </AlertTitle>
          <AlertDescription className="space-y-3 pt-1">
            <p>The connector is running. The address only reaches it once you finish the route and Access steps.</p>
            <div>
              <OpenLink href={cloudflareLinks.tunnelRoutes(activeTunnel)}>Open Tunnel in Cloudflare</OpenLink>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {(status === "failed" || status === "unavailable") && (
        <Alert variant="destructive">
          <AlertTitle>Tandem is not reachable from outside</AlertTitle>
          <AlertDescription>{state?.message ?? "The tunnel stopped."}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
