import { AlertCircleIcon, WifiOffIcon } from "lucide-react";
import { PairScreen } from "@/auth/pair-screen.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { type ConnectionState, useConnected } from "@/rpc/connection.tsx";

/** Shown while the connection is down; the page reconnects by itself. */
export function ConnectionAlert() {
  const { status } = useConnected();
  if (status === undefined || status.status === "connected") return null;
  return (
    <div className="p-2">
      <Alert>
        <WifiOffIcon />
        <AlertTitle>{status.status === "connecting" ? "Reconnecting…" : "Disconnected from the server"}</AlertTitle>
        <AlertDescription>The page reconnects by itself. Nothing is lost.</AlertDescription>
      </Alert>
    </div>
  );
}

export function ConnectionScreen({ state }: { state: Exclude<ConnectionState, { kind: "connected" }> }) {
  if (state.kind === "unauthorized") return <PairScreen />;
  return (
    <Empty className="h-dvh">
      <EmptyHeader>
        {state.kind === "connecting" && (
          <>
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Connecting to the server</EmptyTitle>
          </>
        )}
        {state.kind === "failed" && (
          <>
            <EmptyMedia variant="icon">
              <AlertCircleIcon />
            </EmptyMedia>
            <EmptyTitle>Cannot reach the Tandem server</EmptyTitle>
            <EmptyDescription>{state.message}</EmptyDescription>
            <Button size="sm" variant="outline" onClick={state.retry}>
              Try again
            </Button>
          </>
        )}
      </EmptyHeader>
    </Empty>
  );
}
