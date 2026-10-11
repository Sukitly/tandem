import { AlertCircleIcon, KeyRoundIcon, MessageSquareIcon, WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./app/sidebar.tsx";
import { ChatView } from "./chat/chat-view.tsx";
import { ProvidersDialogProvider } from "./models/providers-dialog.tsx";
import { ConnectionProvider, useConnected } from "./rpc/connection.tsx";
import { ThemeProvider } from "./theme.tsx";

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ConnectionProvider fallback={(state) => <ConnectionScreen state={state} />}>
          <ProvidersDialogProvider>
            <Workbench />
          </ProvidersDialogProvider>
        </ConnectionProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

function Workbench() {
  const [selected, select] = useSelectedConversation();
  return (
    <SidebarProvider>
      <AppSidebar selected={selected} onSelect={select} />
      <SidebarInset className="h-dvh min-w-0">
        <ConnectionAlert />
        {selected === null ? (
          <>
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <SidebarTrigger />
            </header>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareIcon />
                </EmptyMedia>
                <EmptyTitle>No conversation open</EmptyTitle>
                <EmptyDescription>Start a conversation in a directory from the sidebar.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </>
        ) : (
          <ChatView conversationId={selected} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Shown while the connection is down; the page reconnects by itself. */
function ConnectionAlert() {
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

function ConnectionScreen({ state }: { state: { kind: "connecting" | "unauthorized" | "failed"; message?: string } }) {
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
        {state.kind === "unauthorized" && (
          <>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>This page needs the server's token</EmptyTitle>
            <EmptyDescription>Open the URL the Tandem server printed when it started.</EmptyDescription>
          </>
        )}
        {state.kind === "failed" && (
          <>
            <EmptyMedia variant="icon">
              <AlertCircleIcon />
            </EmptyMedia>
            <EmptyTitle>Cannot reach the Tandem server</EmptyTitle>
            <EmptyDescription>{state.message}</EmptyDescription>
          </>
        )}
      </EmptyHeader>
    </Empty>
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
