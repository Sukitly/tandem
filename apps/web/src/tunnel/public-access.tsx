import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { tunnelTokenIdentity } from "@tandem/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { createContext, type MouseEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { cloudflareLinks, pastedToken } from "./cloudflare.ts";
import { PublicAccessFlow } from "./setup-guide.tsx";
import { OpenLink } from "./step.tsx";

const PublicAccessPageContext = createContext<{ href: string; onClick(event: MouseEvent<HTMLAnchorElement>): void }>({
  href: "/#public-access",
  onClick: () => {},
});
export function usePublicAccessPage() {
  return useContext(PublicAccessPageContext);
}

export function PublicAccessPageProvider({ children }: { children: ReactNode }) {
  const workspaceUrl = useRef("/");
  const [open, setOpen] = useState(() => window.location.hash === "#public-access");
  useEffect(() => {
    const update = () => setOpen(window.location.hash === "#public-access");
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.title;
    document.title = "Public access · Tandem";
    return () => {
      document.title = previous;
    };
  }, [open]);
  const navigate = (event: MouseEvent<HTMLAnchorElement>, show: boolean) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target && event.currentTarget.target !== "_self")
    )
      return;
    event.preventDefault();
    if (show) workspaceUrl.current = window.location.pathname + window.location.search + window.location.hash;
    window.history.pushState(null, "", event.currentTarget.href);
    setOpen(show);
  };
  return (
    <PublicAccessPageContext.Provider value={{ href: "/#public-access", onClick: (event) => navigate(event, true) }}>
      <div hidden={open}>{children}</div>
      {open && <PublicAccessPage backHref={workspaceUrl.current} onBack={(event) => navigate(event, false)} />}
    </PublicAccessPageContext.Provider>
  );
}

function PublicAccessPage({
  backHref,
  onBack,
}: {
  backHref: string;
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { publicAccess } = useConnected();
  const state = useReplicatedState(publicAccess.state);
  const [origin, setOrigin] = useState("https://");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const run = (operation: () => Promise<unknown>): void => {
    setError(null);
    operation().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };

  const installed = state?.cloudflared ?? false;
  const status = state?.status ?? "none";
  const activeTunnel = state?.tunnel ?? (token ? tunnelTokenIdentity(pastedToken(token) ?? token) : undefined);

  return (
    <main className="h-dvh overflow-y-auto" aria-label="Public access">
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10 [overflow-wrap:anywhere]">
        <header className="space-y-3">
          <nav aria-label="Page navigation">
            <a
              href={backHref}
              onClick={onBack}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Back to workspace
            </a>
          </nav>
          <h1 className="text-2xl font-semibold" tabIndex={-1} ref={focusHeading}>
            Public access
          </h1>
          <p className="text-muted-foreground">
            Reach this Tandem from your phone, even on mobile data, through a Cloudflare tunnel this machine runs.
          </p>
        </header>

        {installed && status === "authorizing" && (
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

        {installed && status === "starting" && (
          <p className="flex items-center gap-2 text-sm">
            <Spinner /> Starting the tunnel…
          </p>
        )}

        {installed && status === "connected" && (
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

        {installed && (status === "failed" || status === "unavailable") && (
          <Alert variant="destructive">
            <AlertTitle>Tandem is not reachable from outside</AlertTitle>
            <AlertDescription>{state?.message ?? "The tunnel stopped."}</AlertDescription>
          </Alert>
        )}

        <PublicAccessFlow
          installed={installed}
          connected={status === "connected"}
          origin={status === "connected" && state?.publicUrl ? state.publicUrl : origin}
          token={token}
          onOriginChange={setOrigin}
          onTokenChange={setToken}
          onSubmit={(event) => {
            event.preventDefault();
            const cleanToken = (pastedToken(token) ?? token).trim();
            run(() => publicAccess.publish({ publicUrl: origin.trim(), token: cleanToken }, BACKGROUND_CONTEXT));
          }}
          tunnel={activeTunnel}
          stopControl={
            <Button variant="destructive" onClick={() => setConfirmStop(true)}>
              Stop publishing
            </Button>
          }
        />

        {error !== null && <FieldError>{error}</FieldError>}
      </div>

      {confirmStop && (
        <AlertDialog open onOpenChange={() => setConfirmStop(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop publishing?</AlertDialogTitle>
              <AlertDialogDescription>
                This machine stops answering at that address. The tunnel and its DNS record stay in Cloudflare, so
                publishing again takes one step.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => publicAccess.unpublish(BACKGROUND_CONTEXT))}>
                Stop publishing
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </main>
  );
}

function focusHeading(node: HTMLHeadingElement | null) {
  node?.focus();
}
