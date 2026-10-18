import type { ConversationSummary } from "@tandem/contracts";
import { EllipsisIcon } from "lucide-react";
import { ConversationMenu } from "@/chat/conversation-menu.tsx";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { cn } from "@/lib/utils.ts";
import { useCloseSidebarOnNavigate } from "./sidebar-navigation.ts";

export const CONVERSATION_ACTION_CLASS =
  "opacity-0 group-hover/conv-row:opacity-100 group-focus-within/conv-row:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100";

/** Conversation entry in a project sub-list. */
export function ProjectConversationItem({
  summary,
  selected,
}: {
  summary: ConversationSummary;
  selected: number | null;
}) {
  const closeNavigation = useCloseSidebarOnNavigate();
  const isSelected = summary.id === selected;
  return (
    <SidebarMenuSubItem className="group/conv-row relative">
      <SidebarMenuSubButton
        href={`#${summary.id}`}
        onClick={closeNavigation}
        isActive={isSelected}
        aria-current={isSelected ? "page" : undefined}
        className={cn(isSelected && "bg-sidebar-accent", "pr-7")}
      >
        <span className="truncate">{summary.title}</span>
        {summary.running && <Spinner aria-label="Running" className="ml-auto" />}
      </SidebarMenuSubButton>
      <ConversationMenu
        summary={summary}
        side="right"
        trigger={
          <SidebarMenuAction
            className={cn(CONVERSATION_ACTION_CLASS, "top-1 right-1")}
            title="More"
            aria-label={`More for ${summary.title}`}
          >
            <EllipsisIcon />
          </SidebarMenuAction>
        }
      />
    </SidebarMenuSubItem>
  );
}

/** Conversation entry in the recents list. */
export function RecentConversationItem({
  summary,
  selected,
  projectName,
}: {
  summary: ConversationSummary;
  selected: number | null;
  projectName?: string;
}) {
  const closeNavigation = useCloseSidebarOnNavigate();
  const isSelected = summary.id === selected;
  return (
    <SidebarMenuItem className="group/conv-row relative">
      <SidebarMenuButton
        render={<a href={`#${summary.id}`} onClick={closeNavigation} aria-current={isSelected ? "page" : undefined} />}
        isActive={isSelected}
        className={cn(isSelected && "bg-sidebar-accent", "pr-7")}
        title={summary.cwd}
      >
        <span className="truncate">{summary.title}</span>
        {summary.running ? (
          <Spinner aria-label="Running" className="ml-auto" />
        ) : (
          projectName !== undefined && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{projectName}</span>
          )
        )}
      </SidebarMenuButton>
      <ConversationMenu
        summary={summary}
        side="right"
        trigger={
          <SidebarMenuAction
            className={CONVERSATION_ACTION_CLASS}
            title="More"
            aria-label={`More for ${summary.title}`}
          >
            <EllipsisIcon />
          </SidebarMenuAction>
        }
      />
    </SidebarMenuItem>
  );
}
