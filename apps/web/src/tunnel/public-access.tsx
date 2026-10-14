import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createContext, type ReactNode, useContext, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { PublicAccessSetupGuide } from "./setup-guide.tsx";

const PublicAccessDialogContext = createContext<{ open(): void }>({ open: () => {} });
export function usePublicAccessDialog(): { open(): void } {
  return useContext(PublicAccessDialogContext);
}

export function PublicAccessDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <PublicAccessDialogContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {open && <PublicAccessDialog onOpenChange={setOpen} />}
    </PublicAccessDialogContext.Provider>
  );
}

function PublicAccessDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
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

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl [overflow-wrap:anywhere]">
        <DialogHeader>
          <DialogTitle>Public access</DialogTitle>
          <DialogDescription>Set up access from your phone, even on mobile data.</DialogDescription>
        </DialogHeader>

        {status === "none" && (
          <PublicAccessSetupGuide installed={installed}>
            <form
              className="flex min-w-0 flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => publicAccess.publish({ publicUrl: origin.trim(), token: token.trim() }, BACKGROUND_CONTEXT));
              }}
            >
              <Field>
                <FieldLabel htmlFor="public-access-origin">The address it will answer at</FieldLabel>
                <Input
                  id="public-access-origin"
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                  placeholder="https://tandem.example.com"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="public-access-token">Tunnel token</FieldLabel>
                <Input
                  id="public-access-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="eyJhIjoi…"
                  autoComplete="off"
                />
              </Field>
              <Button type="submit" disabled={!installed || !validOrigin(origin) || token.trim() === ""}>
                Publish
              </Button>
            </form>
          </PublicAccessSetupGuide>
        )}

        {installed && status === "authorizing" && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm">
              <Spinner /> Waiting for you to approve this machine in the browser.
            </p>
            {state?.authorizationUrl !== undefined && (
              <a className="text-sm underline" href={state.authorizationUrl} target="_blank" rel="noreferrer">
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
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Published at <span className="font-medium">{state?.publicUrl}</span>.
            </p>
            <p className="text-sm text-muted-foreground">Keep the Tandem host awake and running.</p>
            <h3 className="font-medium">Pair your phone</h3>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Open Devices in this paired browser and create a pairing link.</li>
              <li>
                Open that public-hostname link on your phone within five minutes. Pass Cloudflare Access if prompted.
              </li>
              <li>Bookmark the HTTPS address. Mobile data works; localhost links do not.</li>
            </ol>
            <Button variant="destructive" onClick={() => setConfirmStop(true)}>
              Stop publishing
            </Button>
          </div>
        )}

        {installed && (status === "failed" || status === "unavailable") && (
          <Alert variant="destructive">
            <AlertTitle>Tandem is not reachable from outside</AlertTitle>
            <AlertDescription>{state?.message ?? "The tunnel stopped."}</AlertDescription>
          </Alert>
        )}

        {error !== null && <FieldError>{error}</FieldError>}
      </DialogContent>

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
    </Dialog>
  );
}

function validOrigin(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname !== "" && url.origin === value.trim();
  } catch {
    return false;
  }
}
