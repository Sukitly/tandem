import { AlertCircleIcon, FolderPlusIcon, MessageSquareIcon, WifiOffIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarInset } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner.tsx";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DraftsProvider } from "./app/drafts.tsx";
import { AppSidebar, SidebarToggle } from "./app/sidebar.tsx";
import { AppSidebarProvider } from "./app/sidebar-provider.tsx";
import { useWorkbench, WorkbenchProvider } from "./app/workbench.tsx";
import { WithFiles } from "./app/workspace-layout.tsx";
import { DevicesDialogProvider } from "./auth/devices-dialog.tsx";
import { PairScreen } from "./auth/pair-screen.tsx";
import { ChatView, NewChat } from "./chat/chat-view.tsx";
import { ProvidersDialogProvider } from "./models/providers-dialog.tsx";
import { ConnectionProvider, type ConnectionState, useConnected } from "./rpc/connection.tsx";
import { useReplicatedState } from "./rpc/use-replicated-state.ts";
import { ThemeProvider, useTheme } from "./theme.tsx";
import { PublicAccessPageProvider } from "./tunnel/public-access.tsx";

export { WithFiles };

function AppToaster() {
  const { choice } = useTheme();
  return <Toaster theme={choice} closeButton />;
}

export function App({ initialPairCode }: { initialPairCode?: string } = {}) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <AppToaster />
        {initialPairCode !== undefined ? (
          <PairScreen initialCode={initialPairCode} />
        ) : (
          <DraftsProvider>
            <ConnectionProvider fallback={(state) => <ConnectionScreen state={state} />}>
              <DevicesDialogProvider>
                <ProvidersDialogProvider>
                  <PublicAccessPageProvider>
                    <Workbench />
                  </PublicAccessPageProvider>
                </ProvidersDialogProvider>
              </DevicesDialogProvider>
            </ConnectionProvider>
          </DraftsProvider>
        )}
      </TooltipProvider>
    </ThemeProvider>
  );
}

function Workbench() {
  return (
    <WorkbenchProvider>
      <AppSidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-dvh min-w-0 overflow-hidden md:peer-data-[variant=inset]:h-[calc(100dvh-1rem)]">
          <ConnectionAlert />
          <Main />
        </SidebarInset>
      </AppSidebarProvider>
    </WorkbenchProvider>
  );
}

function Main() {
  const { workspaces } = useConnected();
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  const { selected, draft, workspaceId, addProject } = useWorkbench();
  return (
    <WithFiles workspaceId={workspaceId} availableWorkspaceIds={listed?.map((workspace) => workspace.id)}>
      {draft !== null ? (
        <NewChat key={draft} workspaceId={draft} />
      ) : selected !== null ? (
        <ChatView conversationId={selected} />
      ) : (
        <EmptyWorkspace empty={listed?.length === 0} addProject={addProject} />
      )}
    </WithFiles>
  );
}

function EmptyWorkspace({ empty, addProject }: { empty: boolean; addProject(): void }) {
  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <SidebarToggle />
      </header>
      {empty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlusIcon />
            </EmptyMedia>
            <EmptyTitle>Add a project</EmptyTitle>
            <EmptyDescription>A project is a directory on this machine. Its conversations work in it.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={addProject}>Add project</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareIcon />
            </EmptyMedia>
            <EmptyTitle>No conversation open</EmptyTitle>
            <EmptyDescription>Choose a conversation in the sidebar, or start a new one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
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

function ConnectionScreen({ state }: { state: Exclude<ConnectionState, { kind: "connected" }> }) {
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
