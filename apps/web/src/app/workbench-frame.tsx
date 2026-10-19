import { Outlet } from "@tanstack/react-router";
import { SidebarInset } from "@/components/ui/sidebar.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ConnectionAlert } from "./connection-screen.tsx";
import { useConversationId, useNewConversationWorkspaceId } from "./current-route.ts";
import { AppSidebar } from "./sidebar.tsx";
import { AppSidebarProvider } from "./sidebar-provider.tsx";
import { useWorkbench, WorkbenchProvider } from "./workbench.tsx";
import { WithFiles } from "./workspace-layout.tsx";

/** The sidebar, and beside it the open page with the panel of the project the page is about. */
export function WorkbenchFrame() {
  const workspaceId = useOpenWorkspaceId();
  return (
    <WorkbenchProvider workspaceId={workspaceId}>
      <AppSidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-dvh min-w-0 overflow-hidden md:peer-data-[variant=inset]:h-[calc(100dvh-1rem)]">
          <ConnectionAlert />
          <Pages />
        </SidebarInset>
      </AppSidebarProvider>
    </WorkbenchProvider>
  );
}

/** The project the open page is about: the one a new conversation starts in, or the one the open conversation is in. */
function useOpenWorkspaceId(): number | null {
  const { conversations } = useConnected();
  const summaries = useReplicatedState(conversations.state)?.conversations;
  const conversationId = useConversationId();
  const newConversationIn = useNewConversationWorkspaceId();
  return newConversationIn ?? summaries?.find((summary) => summary.id === conversationId)?.workspaceId ?? null;
}

function Pages() {
  const { workspaces } = useConnected();
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  const { workspaceId } = useWorkbench((state) => ({ workspaceId: state.workspaceId }));
  return (
    <WithFiles workspaceId={workspaceId} availableWorkspaceIds={listed?.map((workspace) => workspace.id)}>
      <Outlet />
    </WithFiles>
  );
}
