import { Link, Navigate, useParams, useRouteContext } from "@tanstack/react-router";
import { FileQuestionIcon } from "lucide-react";
import { PairScreen } from "@/auth/pair-screen.tsx";
import { ChatView } from "@/chat/chat-view.tsx";
import { NewChat } from "@/chat/new-chat.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty.tsx";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { idOf } from "./current-route.ts";
import { EmptyWorkspace } from "./empty-workspace.tsx";
import { SidebarToggle } from "./sidebar-brand.tsx";
import { useWorkbench } from "./workbench.tsx";

/** A device that is not paired yet: outside the session, which it has no connection to open. */
export function PairPage() {
  const { pairCode } = useRouteContext({ from: "/pair" });
  return <PairScreen {...(pairCode === undefined ? {} : { initialCode: pairCode })} />;
}

export function HomePage() {
  const { workspaces } = useConnected();
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  const { addProject } = useWorkbench((state) => ({ addProject: state.addProject }));
  return <EmptyWorkspace empty={listed?.length === 0} addProject={addProject} />;
}

/** A conversation that is not there, such as one deleted on another device, is not a page. */
export function ConversationPage() {
  const id = idOf(useParams({ from: "/session/c/$conversationId" }).conversationId);
  const { conversations } = useConnected();
  const listed = useReplicatedState(conversations.state)?.conversations;
  if (id === null) return <NotFoundPage />;
  if (listed !== undefined && !listed.some((summary) => summary.id === id)) return <Navigate to="/" replace />;
  return <ChatView conversationId={id} />;
}

export function NewConversationPage() {
  const id = idOf(useParams({ from: "/session/p/$workspaceId/new" }).workspaceId);
  const { workspaces } = useConnected();
  const listed = useReplicatedState(workspaces.state)?.workspaces;
  if (id === null) return <NotFoundPage />;
  if (listed !== undefined && !listed.some((project) => project.id === id)) return <Navigate to="/" replace />;
  return <NewChat key={id} workspaceId={id} />;
}

export function NotFoundPage() {
  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <SidebarToggle />
      </header>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionIcon />
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>There is nothing at this address.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to="/" className={buttonVariants()}>
            Back to workspace
          </Link>
        </EmptyContent>
      </Empty>
    </>
  );
}
