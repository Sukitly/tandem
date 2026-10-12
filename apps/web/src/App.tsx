import { AlertCircleIcon, FolderPlusIcon, KeyRoundIcon, MessageSquareIcon, WifiOffIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectPanel } from "./app/project-panel.tsx";
import { AppSidebar } from "./app/sidebar.tsx";
import { useWorkbench, WorkbenchProvider } from "./app/workbench.tsx";
import { ChatView, NewChat } from "./chat/chat-view.tsx";
import { ProvidersDialogProvider } from "./models/providers-dialog.tsx";
import { ConnectionProvider, useConnected } from "./rpc/connection.tsx";
import { useReplicatedState } from "./rpc/use-replicated-state.ts";
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
  return (
    <WorkbenchProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-dvh min-w-0">
          <ConnectionAlert />
          <FailureAlert />
          <Main />
        </SidebarInset>
      </SidebarProvider>
    </WorkbenchProvider>
  );
}

function Main() {
  const { workspaces } = useConnected();
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  const { selected, draft, workspaceId, addProject } = useWorkbench();
  if (draft !== null || selected !== null) {
    return (
      <WithFiles workspaceId={workspaceId}>
        {/* Keyed, so that starting another new conversation begins from an empty box. */}
        {draft !== null ? <NewChat key={draft} workspaceId={draft} /> : <ChatView conversationId={selected ?? 0} />}
      </WithFiles>
    );
  }
  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <SidebarTrigger />
      </header>
      {listed?.length === 0 ? (
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

/** The conversation, and the files panel of its project beside it when shown. Their widths are kept across reloads. */
function WithFiles({ workspaceId, children }: { workspaceId: number | null; children: ReactNode }) {
  const { filesShown } = useWorkbench();
  const shown = filesShown && workspaceId !== null;
  const layout = useDefaultLayout({
    id: "tandem.layout",
    panelIds: shown ? ["conversation", "files"] : ["conversation"],
    storage: localStorage,
  });
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel id="conversation" minSize={360} className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
      {shown && (
        <>
          <ResizableHandle />
          <ResizablePanel id="files" defaultSize="35" minSize={240}>
            {/* Keyed, so that another project starts with its own tree. */}
            <ProjectPanel key={workspaceId} workspaceId={workspaceId} />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

/** Something the user asked for in the sidebar that did not happen. */
function FailureAlert() {
  const { failure, dismissFailure } = useWorkbench();
  if (failure === null) return null;
  return (
    <div className="p-2">
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>{failure.title}</AlertTitle>
        <AlertDescription>{failure.message}</AlertDescription>
        <AlertAction>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={dismissFailure}>
            <XIcon />
          </Button>
        </AlertAction>
      </Alert>
    </div>
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
