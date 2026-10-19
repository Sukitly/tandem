import { SidebarInset } from "@/components/ui/sidebar.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { ConnectionAlert, ConnectionScreen } from "./app/connection-screen.tsx";
import { DraftsProvider } from "./app/drafts.tsx";
import { EmptyWorkspace } from "./app/empty-workspace.tsx";
import { ApplicationRouter } from "./app/router.tsx";
import { AppSidebar } from "./app/sidebar.tsx";
import { AppSidebarProvider } from "./app/sidebar-provider.tsx";
import { useWorkbench, WorkbenchProvider } from "./app/workbench.tsx";
import { WithFiles } from "./app/workspace-layout.tsx";
import { DevicesDialogProvider } from "./auth/devices-dialog.tsx";
import { PairScreen } from "./auth/pair-screen.tsx";
import { ChatView, NewChat } from "./chat/chat-view.tsx";
import { ProvidersDialogProvider } from "./models/providers-dialog.tsx";
import { ConnectionProvider, useConnected } from "./rpc/connection.tsx";
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
          <DraftsProvider>
            <ConnectionProvider fallback={(state) => <ConnectionScreen state={state} />}>
              <ApplicationRouter>
                <DevicesDialogProvider>
                  <ProvidersDialogProvider>
                    <PublicAccessPageProvider>
                      <Workbench />
                    </PublicAccessPageProvider>
                  </ProvidersDialogProvider>
                </DevicesDialogProvider>
              </ApplicationRouter>
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
  const { selected, draft, workspaceId, addProject } = useWorkbench((state) => ({
    selected: state.selected,
    draft: state.draft,
    workspaceId: state.workspaceId,
    addProject: state.addProject,
  }));

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
