import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { tunnelTokenIdentity } from "@tandem/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { createContext, type MouseEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { navigate as navigateTo, routeHash, useRoute } from "@/app/navigation.ts";
import { Button } from "@/components/ui/button.tsx";
import { FieldError } from "@/components/ui/field.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { pastedToken } from "./cloudflare.ts";
import { PublicAccessStatus } from "./public-access-status.tsx";
import { PublicAccessFlow } from "./setup-guide.tsx";
import { UnpublishDialog } from "./unpublish-dialog.tsx";

const PublicAccessPageContext = createContext<{ href: string; onClick(event: MouseEvent<HTMLAnchorElement>): void }>({
  href: `/${routeHash({ kind: "publicAccess" })}`,
  onClick: () => {},
});

export function usePublicAccessPage() {
  return useContext(PublicAccessPageContext);
}

export function PublicAccessPageProvider({ children }: { children: ReactNode }) {
  const workspaceUrl = useRef("/");
  const route = useRoute();
  const open = route.kind === "publicAccess";

  useEffect(() => {
    if (route.kind !== "publicAccess") {
      workspaceUrl.current = window.location.pathname + window.location.search + window.location.hash;
    }
  }, [route]);

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
    navigateTo(event.currentTarget.href);
  };

  return (
    <PublicAccessPageContext.Provider
      value={{ href: `/${routeHash({ kind: "publicAccess" })}`, onClick: (event) => navigate(event, true) }}
    >
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
  const [publishing, setPublishing] = useState(false);
  const [stopping, setStopping] = useState(false);

  const installed = state?.cloudflared ?? false;
  const status = state?.status ?? "none";
  const isPublishing = publishing || status === "starting" || status === "authorizing";

  useEffect(() => {
    if (status === "connected" || status === "failed" || status === "unavailable" || status === "none") {
      setPublishing(false);
    }
  }, [status]);

  const activeTunnel = state?.tunnel ?? (token ? tunnelTokenIdentity(pastedToken(token) ?? token) : undefined);

  const stopPublishing = async () => {
    setStopping(true);
    setError(null);
    try {
      await publicAccess.unpublish(BACKGROUND_CONTEXT);
      setConfirmStop(false);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setStopping(false);
    }
  };

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

        <PublicAccessStatus state={state} activeTunnel={activeTunnel} />

        <PublicAccessFlow
          installed={installed}
          connected={status === "connected"}
          origin={status === "connected" && state?.publicUrl ? state.publicUrl : origin}
          token={token}
          onOriginChange={setOrigin}
          onTokenChange={setToken}
          publishing={isPublishing}
          onSubmit={async (event) => {
            event.preventDefault();
            const cleanToken = (pastedToken(token) ?? token).trim();
            setPublishing(true);
            setError(null);
            try {
              await publicAccess.publish({ publicUrl: origin.trim(), token: cleanToken }, BACKGROUND_CONTEXT);
            } catch (failure: unknown) {
              setError(failure instanceof Error ? failure.message : String(failure));
            } finally {
              setPublishing(false);
            }
          }}
          tunnel={activeTunnel}
          stopControl={
            <Button variant="destructive" disabled={stopping} onClick={() => setConfirmStop(true)}>
              {stopping && <Spinner />}
              {stopping ? "Stopping…" : "Stop publishing"}
            </Button>
          }
        />

        {error !== null && <FieldError>{error}</FieldError>}
      </div>

      <UnpublishDialog
        open={confirmStop}
        stopping={stopping}
        onOpenChange={(open) => {
          if (!stopping) setConfirmStop(open);
        }}
        onConfirm={stopPublishing}
      />
    </main>
  );
}

function focusHeading(node: HTMLHeadingElement | null) {
  node?.focus();
}
