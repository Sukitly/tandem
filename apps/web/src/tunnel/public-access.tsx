import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { tunnelTokenIdentity } from "@tandem/contracts";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { FieldError } from "@/components/ui/field.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { isPlainClick } from "@/lib/click.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { pastedToken } from "./cloudflare.ts";
import { PublicAccessStatus } from "./public-access-status.tsx";
import { PublicAccessFlow } from "./setup-guide.tsx";
import { UnpublishDialog } from "./unpublish-dialog.tsx";

/** The page for publishing this machine, in place of the workbench, which waits hidden behind it. */
export function PublicAccessPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Public access · Tandem";
    return () => {
      document.title = previous;
    };
  }, []);

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
            <BackToWorkspace />
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

/** Back, when the workspace is where this page was reached from, returns to the very page it left. */
function BackToWorkspace() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <Link
      to="/"
      onClick={(event) => {
        if (!canGoBack || !isPlainClick(event)) return;
        event.preventDefault();
        router.history.back();
      }}
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
    >
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      Back to workspace
    </Link>
  );
}
