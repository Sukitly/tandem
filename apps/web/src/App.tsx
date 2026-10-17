import { AlertCircleIcon, FolderPlusIcon, MessageSquareIcon, WifiOffIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarInset } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner.tsx";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile.ts";
import { ProjectPanel } from "./app/project-panel.tsx";
import { AppSidebar, SidebarToggle } from "./app/sidebar.tsx";
import { AppSidebarProvider } from "./app/sidebar-provider.tsx";
import { useWorkbench, WorkbenchProvider } from "./app/workbench.tsx";
import { DevicesDialogProvider } from "./auth/devices-dialog.tsx";
import { PairScreen } from "./auth/pair-screen.tsx";
import { ChatView, NewChat } from "./chat/chat-view.tsx";
import { ProvidersDialogProvider } from "./models/providers-dialog.tsx";
import { ConnectionProvider, type ConnectionState, useConnected } from "./rpc/connection.tsx";
import { useReplicatedState } from "./rpc/use-replicated-state.ts";
import { ThemeProvider, useTheme } from "./theme.tsx";
import { PublicAccessPageProvider } from "./tunnel/public-access.tsx";

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
          <ConnectionProvider fallback={(state) => <ConnectionScreen state={state} />}>
            <DevicesDialogProvider>
              <ProvidersDialogProvider>
                <PublicAccessPageProvider>
                  <Workbench />
                </PublicAccessPageProvider>
              </ProvidersDialogProvider>
            </DevicesDialogProvider>
          </ConnectionProvider>
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
        <SidebarToggle />
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
export function WithFiles({ workspaceId, children }: { workspaceId: number | null; children?: ReactNode }) {
  const { filesShown, showFiles } = useWorkbench();
  const isMobile = useIsMobile();
  const shown = filesShown && workspaceId !== null;
  const layout = useDefaultLayout({
    id: "tandem.layout",
    panelIds: shown ? ["conversation", "files"] : ["conversation"],
    storage: typeof localStorage !== "undefined" ? localStorage : undefined,
  });

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
        {workspaceId !== null && (
          <Drawer open={shown} onOpenChange={(open) => showFiles(open)} showSwipeHandle>
            <DrawerContent keepMounted className="h-[85dvh] max-h-[85dvh] p-0 pb-[env(safe-area-inset-bottom,0px)]">
              <DrawerHeader className="sr-only">
                <DrawerTitle>Project panel</DrawerTitle>
                <DrawerDescription>Project files, changes, and terminal</DrawerDescription>
              </DrawerHeader>
              <div className="flex min-h-0 flex-1 flex-col">
                <ProjectPanel
                  key={workspaceId}
                  workspaceId={workspaceId}
                  active={shown}
                  onClose={() => showFiles(false)}
                />
              </div>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    );
  }

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
