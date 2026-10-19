import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationSummary, WorkspaceSummary } from "@tandem/contracts";
import { Link } from "@tanstack/react-router";
import { EllipsisIcon, FolderIcon, FolderMinusIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from "@/components/ui/sidebar.tsx";
import { useCommand } from "@/hooks/use-command.ts";
import { useConnected } from "@/rpc/connection.tsx";
import { useReplicatedState } from "@/rpc/use-replicated-state.ts";
import { ProjectConversationItem } from "./sidebar-conversation-row.tsx";
import { useCloseSidebarOnNavigate } from "./sidebar-navigation.ts";

export const PROJECT_ACTION_CLASS =
  "opacity-0 group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100";

/** A project that opens to show its conversations. Its row reveals actions on hover or keyboard focus. */
export function ProjectItem({
  project,
  conversations,
  selected,
}: {
  project: WorkspaceSummary;
  conversations: ConversationSummary[];
  selected: number | null;
}) {
  // A page about the project leaves by itself: the project is no longer there.
  const removal = useCommand({ failure: "Could not remove the project" });
  const closeNavigation = useCloseSidebarOnNavigate();
  const { terminals, workspaces } = useConnected();
  const running = (useReplicatedState(terminals.state)?.terminals ?? []).filter(
    (summary) => summary.workspaceId === project.id && summary.exit === undefined,
  );
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <div className="group/project-row relative">
        <CollapsibleTrigger
          render={
            <SidebarMenuButton title={project.path} className="group-has-data-[sidebar=menu-action]/menu-item:pr-16" />
          }
        >
          {open ? <FolderOpenIcon /> : <FolderIcon />}
          <span>{project.name}</span>
        </CollapsibleTrigger>
        <SidebarMenuAction
          render={<Link to="/p/$workspaceId/new" params={{ workspaceId: String(project.id) }} />}
          className={`${PROJECT_ACTION_CLASS} right-8`}
          title={`New conversation in ${project.name}`}
          aria-label={`New conversation in ${project.name}`}
          onClick={closeNavigation}
        >
          <PlusIcon />
        </SidebarMenuAction>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                className={PROJECT_ACTION_CLASS}
                title="More"
                aria-label={`More for ${project.name}`}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-48">
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <FolderMinusIcon />
              Remove project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and its conversations leave the sidebar. No file or conversation is deleted: add the same
              directory again to bring them back.
            </AlertDialogDescription>
            {running.length > 0 && (
              <AlertDialogDescription>
                {running.length === 1 ? "A terminal is" : `${running.length} terminals are`} still running and will be
                ended, with what runs in {running.length === 1 ? "it" : "them"}:{" "}
                {running.map((summary) => summary.title).join(", ")}.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void removal.run(() => workspaces.remove(project.id, BACKGROUND_CONTEXT));
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {conversations.length > 0 && (
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">
            {conversations.map((summary) => (
              <ProjectConversationItem key={summary.id} summary={summary} selected={selected} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
