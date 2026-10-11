import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "./app/sidebar.tsx";
import { ChatView } from "./chat/chat-view.tsx";
import { ConnectionProvider, useConnected } from "./rpc/connection.tsx";

export function App() {
  return (
    <TooltipProvider>
      <ConnectionProvider fallback={(state) => <ConnectionScreen state={state} />}>
        <Workbench />
      </ConnectionProvider>
    </TooltipProvider>
  );
}

function Workbench() {
  const [selected, select] = useSelectedConversation();
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar selected={selected} onSelect={select} />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        {selected === null ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            Start a conversation in a directory on the left.
          </div>
        ) : (
          <ChatView conversationId={selected} />
        )}
      </main>
    </div>
  );
}

/** Shown while the connection is down; the page reconnects by itself. */
function ConnectionBanner() {
  const { status } = useConnected();
  if (status === undefined || status.status === "connected") return null;
  return (
    <div role="status" className="border-b bg-muted px-4 py-2 text-muted-foreground text-xs">
      {status.status === "connecting" ? "Reconnecting…" : "Disconnected from the server. Retrying…"}
    </div>
  );
}

function ConnectionScreen({ state }: { state: { kind: "connecting" | "unauthorized" | "failed"; message?: string } }) {
  return (
    <div className="flex h-dvh items-center justify-center p-6 text-center text-sm">
      {state.kind === "connecting" && <Spinner aria-label="Connecting to the server" />}
      {state.kind === "unauthorized" && (
        <p className="max-w-md text-muted-foreground">
          This page needs the server's token. Open the URL the Tandem server printed when it started.
        </p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="max-w-md text-destructive">
          Cannot reach the Tandem server: {state.message}
        </p>
      )}
    </div>
  );
}

/** The open conversation, kept in the URL hash so that reloads and links keep it. */
function useSelectedConversation(): [number | null, (id: number) => void] {
  const [selected, setSelected] = useState(selectedInHash);
  useEffect(() => {
    const onChange = (): void => setSelected(selectedInHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [
    selected,
    (id) => {
      window.location.hash = String(id);
    },
  ];
}

function selectedInHash(): number | null {
  const hash = window.location.hash.slice(1);
  const id = Number(hash);
  return hash !== "" && Number.isSafeInteger(id) && id >= 0 ? id : null;
}
